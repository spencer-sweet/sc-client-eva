# EVA Networks — Webflow Cloudflare Worker

Cloudflare Worker that receives Webflow form / webhook POSTs (and related site helpers).

**Deployed URL:** https://eva-networks-webflow-site.dan-sheldon.workers.dev/

## Setup

```bash
pnpm install
```

1. Copy `.env.example` → `.env` and fill in Cloudflare credentials used by `pnpm deploy`.
2. For local webhook signature checks, create **`.dev.vars`** (gitignored):

   ```bash
   WEBFLOW_WEBHOOK_SECRET=your_webhook_secret_here
   POSTMARK_SERVER_TOKEN=your_postmark_server_token
   POSTMARK_FROM=notifications@yourdomain.com
   POSTMARK_TO=you@example.com
   ```

3. For production, set secrets on the Worker:

   ```bash
   pnpm exec wrangler secret put WEBFLOW_WEBHOOK_SECRET
   pnpm exec wrangler secret put POSTMARK_SERVER_TOKEN
   pnpm exec wrangler secret put POSTMARK_FROM # should this be the customer (+ replyTo also)
   pnpm exec wrangler secret put POSTMARK_TO
   ```

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Local Worker on [http://127.0.0.1:8787](http://127.0.0.1:8787) |
| `pnpm tunnel` | Quick Cloudflare Tunnel → local `:8787` (public HTTPS URL) |
| `pnpm deploy` | Deploy to `*.workers.dev` |
| `pnpm tail` | Live logs from the **deployed** Worker (`wrangler tail`) |
| `pnpm build` | Dry-run deploy into `dist/` |
| `pnpm typecheck` | `tsc --noEmit` |

## Project layout

```
src/
  index.ts                 # router + global CORS
  env.ts                   # Worker Env bindings
  lib/
    cors.ts                # OPTIONS + withCors for every response
    parse-body.ts          # JSON / urlencoded / multipart → object
    json-response.ts
    webflow-signature.ts   # HMAC-SHA256 + timestamp check
  types/
    webflow-form.ts        # form_submission + ContactFormData
  routes/
    root.ts                # GET /
    01_dev.ts              # POST /wf/01_dev
    02_parse-form.ts       # POST /wf/02_parse-form
    03_validate.ts         # POST /wf/03_validate (signed)
    04_postmark-write.ts   # POST /wf/04_postmark-write (signed + Postmark)
```

## Routes

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/` | `Hello world` |
| `POST` | `/wf/01_dev` | Log + echo the raw webhook body as JSON |
| `POST` | `/wf/02_parse-form` | Extract typed `ContactFormData` → log + `{ ok, data }` |
| `POST` | `/wf/03_validate` | Same as `02`, but only after Webflow signature verification |
| `POST` | `/wf/04_postmark-write` | Same as `03`, then emails `ContactFormData` via Postmark |
| `OPTIONS` | `*` | CORS preflight (all paths) |

All responses include CORS headers (`Access-Control-Allow-Origin: *`, etc.).

### Contact form fields (`ContactFormData`)

```ts
{
  nameFirst: string;
  nameLast: string;
  nameOrg: string;
  title: string;
  email: string;
}
```

### Expected Webflow webhook body

```json
{
  "triggerType": "form_submission",
  "payload": {
    "name": "Contact Form",
    "siteId": "…",
    "data": {
      "nameFirst": "Spencer",
      "nameLast": "Cappiello",
      "nameOrg": "Finsweet",
      "title": "Mr",
      "email": "spencer.cappiello@finsweet.com"
    },
    "submittedAt": "2026-08-14T13:24:37.091Z",
    "id": "…",
    "formId": "…",
    "formElementId": "…",
    "pageId": "…",
    "publishedPath": "/dev/home14",
    "pageUrl": "https://….webflow.io/dev/home14#contact-us",
    "schema": [],
    "localeId": null
  }
}
```

`/wf/02_parse-form` and `/wf/03_validate` respond with:

```json
{
  "ok": true,
  "data": {
    "nameFirst": "Spencer",
    "nameLast": "Cappiello",
    "nameOrg": "Finsweet",
    "title": "Mr",
    "email": "spencer.cappiello@finsweet.com"
  }
}
```

### Signature validation (`/wf/03_validate`)

Follows [Webflow’s docs](https://developers.webflow.com/data/docs/working-with-webhooks#validating-request-signatures):

1. Read **raw** body string (must match what Webflow signed — do not re-`JSON.stringify`).
2. HMAC-SHA256 of `` `${x-webflow-timestamp}:${rawBody}` `` with `WEBFLOW_WEBHOOK_SECRET`.
3. Timing-safe compare to `x-webflow-signature`.
4. Reject if timestamp is older than **5 minutes**.

On failure → `401` `{ ok: false, error: "…" }`.

**Important:** Webhooks created only in the Webflow dashboard UI often **do not** send signature headers. Prefer an API-created webhook (site token / OAuth) so `x-webflow-timestamp` + `x-webflow-signature` are present. Store the `secretKey` from the create-webhook response as `WEBFLOW_WEBHOOK_SECRET`.

## Pointing a Webflow webhook at this Worker

Webflow **rejects** `http://localhost:…` (“Invalid URL format”). The webhook URL must be a public **HTTPS** endpoint that Webflow’s servers can reach.

### Option A — deployed Worker (stable)

1. `pnpm exec wrangler secret put WEBFLOW_WEBHOOK_SECRET`
2. `pnpm deploy`
3. Webhook URL examples:

   ```
   https://eva-networks-webflow-site.dan-sheldon.workers.dev/wf/01_dev
   https://eva-networks-webflow-site.dan-sheldon.workers.dev/wf/02_parse-form
   https://eva-networks-webflow-site.dan-sheldon.workers.dev/wf/03_validate
   https://eva-networks-webflow-site.dan-sheldon.workers.dev/wf/04_postmark-write
   ```

### Option B — local Worker + Cloudflare Tunnel (dev)

1. Put the secret in `.dev.vars`, then:

   ```bash
   pnpm dev      # terminal 1
   pnpm tunnel   # terminal 2
   ```

2. Use the printed `https://….trycloudflare.com` host, e.g.:

   ```
   https://YOUR-SUBDOMAIN.trycloudflare.com/wf/03_validate
   ```

3. Restart `pnpm dev` after changing `.dev.vars`.

Notes:

- Quick tunnels get a **new hostname** each time you restart `pnpm tunnel`.
- Keep **both** `pnpm dev` and `pnpm tunnel` running while testing.
- First `pnpm install` may need `pnpm approve-builds` so `cloudflared` can install its binary.

### Smoke-test without Webflow

```bash
# echo raw body
curl -X POST "http://127.0.0.1:8787/wf/01_dev" \
  -H "Content-Type: application/json" \
  -d '{"triggerType":"form_submission","payload":{"name":"Contact Form","siteId":"x","data":{"email":"a@b.com","nameFirst":"Ada","nameLast":"L","nameOrg":"X","title":"Ms"},"submittedAt":"2026-08-14T13:24:37.091Z","id":"1","formId":"2","formElementId":"3","pageId":"4","publishedPath":"/","pageUrl":"https://example.com","schema":[],"localeId":null}}'

# parse fields (no signature)
curl -X POST "http://127.0.0.1:8787/wf/02_parse-form" \
  -H "Content-Type: application/json" \
  -d '{"triggerType":"form_submission","payload":{"name":"Contact Form","siteId":"x","data":{"email":"a@b.com","nameFirst":"Ada","nameLast":"L","nameOrg":"X","title":"Ms"},"submittedAt":"2026-08-14T13:24:37.091Z","id":"1","formId":"2","formElementId":"3","pageId":"4","publishedPath":"/","pageUrl":"https://example.com","schema":[],"localeId":null}}'

# signed route without headers → 401
curl -i -X POST "http://127.0.0.1:8787/wf/03_validate" \
  -H "Content-Type: application/json" \
  -d '{"triggerType":"form_submission","payload":{"data":{}}}'
```
