#!/usr/bin/env bash
# Builds every top-level site (any directory containing a package.json) into
# dist/<site-name>/ so each is served at https://<domain>/<site-name>/.
# Cloudflare Pages settings: build command = "bash build.sh", output dir = "dist".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"

rm -rf "$DIST"
mkdir -p "$DIST"

sites=()
for pkg in "$ROOT"/*/package.json; do
  [ -f "$pkg" ] || continue
  name="$(basename "$(dirname "$pkg")")"
  [ "$name" = "node_modules" ] && continue
  sites+=("$name")
done

if [ ${#sites[@]} -eq 0 ]; then
  echo "No sites found (no */package.json)." >&2
  exit 1
fi

for name in "${sites[@]}"; do
  echo "==> Building $name"
  (
    cd "$ROOT/$name"
    if [ -f pnpm-lock.yaml ]; then
      pnpm install --frozen-lockfile
    else
      pnpm install
    fi
    pnpm exec vite build --base="/$name/" --outDir "$DIST/$name" --emptyOutDir
  )
done

echo "==> Generating root index"
# Cloudflare Pages injects these during CI builds; empty locally.
PAGES_URL="${CF_PAGES_URL:-}"
PAGES_SHA="${CF_PAGES_COMMIT_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)}"
{
  cat <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>demos</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
      background: #000;
      color: #33ff33;
      min-height: 100vh;
      padding: 2rem;
      text-shadow: 0 0 6px rgba(51, 255, 51, 0.5);
    }
    /* subtle CRT scanlines */
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.25) 0px, rgba(0, 0, 0, 0.25) 1px, transparent 1px, transparent 3px);
    }
    .line { margin: 0.35rem 0; }
    .prompt { color: #1aff8c; }
    .dim { color: #1c8f1c; }
    a {
      color: #33ff33;
      text-decoration: none;
      display: inline-block;
      padding: 0.15rem 0;
    }
    a::before { content: "> "; color: #1c8f1c; }
    a:hover, a:focus {
      background: #33ff33;
      color: #000;
      text-shadow: none;
      outline: none;
    }
    .version-bar {
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    select {
      font: inherit;
      background: #000;
      color: #33ff33;
      border: 1px solid #1c8f1c;
      padding: 0.2rem 0.4rem;
      text-shadow: inherit;
      max-width: 100%;
      min-width: 0;
      flex: 0 1 auto;
      text-overflow: ellipsis;
    }
    @media (max-width: 480px) {
      body { padding: 1rem; font-size: 0.85rem; }
      .version-bar { flex-direction: column; align-items: stretch; gap: 0.25rem; }
      select { width: 100%; }
    }
    select:focus { outline: 1px solid #33ff33; }
    .cursor {
      display: inline-block;
      width: 0.6em;
      height: 1.1em;
      background: #33ff33;
      vertical-align: text-bottom;
      animation: blink 1s steps(1) infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }
  </style>
</head>
<body>
  <div class="line version-bar">
    <span class="prompt">version:</span>
    <select id="versions" aria-label="Select deployed version">
      <option value="">main (current)</option>
    </select>
  </div>
  <div class="line dim">last login: never — access granted</div>
  <div class="line"><span class="prompt">visitor@demos:~$</span> ls ./demos</div>
HTML
  for name in "${sites[@]}"; do
    echo "  <div class=\"line\"><a href=\"/$name/\">$name</a></div>"
  done
  cat <<'HTML'
  <div class="line"><span class="cursor"></span></div>
HTML
  echo "  <script>window.DEPLOY = { url: '$PAGES_URL', sha: '$PAGES_SHA' };</script>"
  cat <<'HTML'
  <script>
    (function () {
      var REPO = 'spencer-sweet/sc-client-eva';
      var MAX = 15;
      var sel = document.getElementById('versions');

      // Baked in at build time by Cloudflare Pages (CF_PAGES_URL / CF_PAGES_COMMIT_SHA):
      // lets the current deployment show its own pinned URL without any API call.
      var deploy = window.DEPLOY || {};
      if (deploy.url) {
        var deployHash = (deploy.url.split('//')[1] || '').split('.')[0];
        var first = sel.options[0];
        first.textContent = 'main (current) — ' + (deploy.sha || '').slice(0, 7) + ' [' + deployHash + ']';
        first.value = deploy.url;
      }

      sel.addEventListener('change', function () {
        if (sel.value) window.location.href = sel.value;
      });

      var historyOptions = [];
      function renderHistory(list) {
        historyOptions.forEach(function (o) { o.remove(); });
        historyOptions = list.map(function (item) {
          var opt = document.createElement('option');
          opt.value = item.url;
          opt.textContent = item.label;
          if (item.disabled) opt.disabled = true;
          sel.appendChild(opt);
          return opt;
        });
      }

      // Each Cloudflare Pages deploy shows up as a check run on its commit; the
      // check run's external_id is the deployment id, whose first 8 chars are
      // the preview subdomain: https://<id8>.<project>.pages.dev
      var PROJECT = 'sc-client-eva';
      function fetchHistory() {
        return fetch('https://api.github.com/repos/' + REPO + '/commits?per_page=' + MAX)
          .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
          .then(function (commits) {
            if (!Array.isArray(commits)) return Promise.reject();
            var list = [];
            return commits.reduce(function (chain, c) {
              return chain.then(function () {
                return fetch('https://api.github.com/repos/' + REPO + '/commits/' + c.sha + '/check-runs')
                  .then(function (r) { return r.ok ? r.json() : {}; })
                  .then(function (data) {
                    var run = (data.check_runs || []).filter(function (cr) {
                      return cr.name === 'Cloudflare Pages' && cr.conclusion === 'success' && cr.external_id;
                    })[0];
                    if (!run) return;
                    var hash = run.external_id.slice(0, 8);
                    var url = 'https://' + hash + '.' + PROJECT + '.pages.dev';
                    var msg = (c.commit.message || '').split('\n')[0].slice(0, 40);
                    list.push({ label: c.sha.slice(0, 7) + ' — ' + msg + ' [' + hash + ']', url: url });
                  });
              });
            }, Promise.resolve()).then(function () { return list; });
          });
      }

      // The GitHub API allows only 60 unauthenticated requests/hour, so cache
      // the resolved history and reuse it between page loads.
      var CACHE_KEY = 'sc-version-history-v1';
      var CACHE_TTL = 10 * 60 * 1000;
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) {}

      function show(list) {
        renderHistory(list.filter(function (item) { return item.url !== deploy.url; }));
      }

      if (cached && Array.isArray(cached.list)) show(cached.list);
      if (!cached || (Date.now() - cached.t) >= CACHE_TTL) {
        fetchHistory()
          .then(function (list) {
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), list: list })); } catch (e) {}
            show(list);
          })
          .catch(function () {
            if (!cached) renderHistory([{ label: '(version history unavailable)', url: '', disabled: true }]);
          });
      }
    })();
  </script>
</body>
</html>
HTML
} > "$DIST/index.html"

echo "==> Done. Built sites: ${sites[*]}"
