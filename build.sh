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
    .version-bar { margin-bottom: 1.25rem; }
    select {
      font: inherit;
      background: #000;
      color: #33ff33;
      border: 1px solid #1c8f1c;
      padding: 0.2rem 0.4rem;
      text-shadow: inherit;
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
  <script>
    (function () {
      var REPO = 'spencer-sweet/sc-client-eva';
      var MAX = 15;
      var sel = document.getElementById('versions');

      sel.addEventListener('change', function () {
        if (sel.value) window.location.href = sel.value;
      });

      function addOption(label, url) {
        var opt = document.createElement('option');
        opt.value = url;
        opt.textContent = label;
        sel.appendChild(opt);
      }

      // Each Cloudflare Pages deploy shows up as a check run on its commit; the
      // check run's external_id is the deployment id, whose first 8 chars are
      // the preview subdomain: https://<id8>.<project>.pages.dev
      var PROJECT = 'sc-client-eva';
      fetch('https://api.github.com/repos/' + REPO + '/commits?per_page=' + MAX)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (commits) {
          if (!Array.isArray(commits)) return;
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
                  addOption(c.sha.slice(0, 7) + ' — ' + msg + ' [' + hash + ']', url);
                });
            });
          }, Promise.resolve());
        })
        .catch(function () {
          var opt = document.createElement('option');
          opt.disabled = true;
          opt.textContent = '(version history unavailable)';
          sel.appendChild(opt);
        });
    })();
  </script>
</body>
</html>
HTML
} > "$DIST/index.html"

echo "==> Done. Built sites: ${sites[*]}"
