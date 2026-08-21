# Ventanas Take 3

Three.js / Theatre.js "windows" scene (Vite): star GLB, vortex tunnels, scroll timeline, camera. Built as a static bundle for the Webflow page.

**Deployed:** https://sc-client-eva.pages.dev/ventanas-take-3/

## Quick start

```bash
pnpm install
pnpm dev
```

## Query params

| Param | Values | What it does | Example |
| --- | --- | --- | --- |
| `minify` | – | Skips Theatre Studio and the whole Dev UI bar — the production/Webflow-embed mode. | [link](https://sc-client-eva.pages.dev/ventanas-take-3/?minify) |
| `dev` | – | Starts the Dev UI bar expanded instead of minified on load. Purely a convenience — every control is still reachable either way by clicking "▸ Dev UI" to expand it. | [link](https://sc-client-eva.pages.dev/ventanas-take-3/?dev) |
| `quality` | `low` \| `high` | Forces the render quality tier (fbm octaves, tube segments, pixel-ratio cap, …) instead of auto-detecting from the device. `low` is the only way to preview phone-tier rendering on a desktop. | [link](https://sc-client-eva.pages.dev/ventanas-take-3/?quality=low) |
| `scrollSource` | `page` \| `sections` \| `sections-webflow` \| `external` | Overrides the "Scroll Source" dropdown — what drives the Theatre.js timeline scrub. | [link](https://sc-client-eva.pages.dev/ventanas-take-3/?scrollSource=external) |

Params combine freely, e.g. [`?dev&quality=low`](https://sc-client-eva.pages.dev/ventanas-take-3/?dev&quality=low).
