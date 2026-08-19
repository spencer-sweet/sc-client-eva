# EVA Networks — site extras

This repo holds the Webflow site’s custom 3D scene, contact-form Worker, and source media. Everything else in the tree is an older experiment; **work happens in the three directories below**.

## Primary directories

- **[ventanas-take-3/](./ventanas-take-3/)** — Current Three.js / Theatre.js “windows” scene (Vite). Built as a static bundle for the Webflow page: star GLB, vortex, scroll timeline, camera. Run locally with `pnpm dev` from that folder.

- **[cf-worker/](./cf-worker/)** — Cloudflare Worker for Webflow form webhooks: parse, verify signatures, email via Postmark. Deployed Worker and route docs live in **[cf-worker/README.md](./cf-worker/README.md)**.

- **[assets/](./assets/)** — Source media used by the scene and site (star-shatter GLBs, 4-pointed-star SVGs, Rive animations). Copy or export into `ventanas-take-3/public` (or Webflow) as needed; this folder is the library, not the live CDN path.

## Quick start

```bash
# 3D scene
cd ventanas-take-3 && pnpm install && pnpm dev

# Worker (webhooks + Postmark)
cd cf-worker && pnpm install && pnpm dev
```
