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
| `quality` | `low` \| `mid` \| `high` | Forces the render quality tier (fbm octaves, tube segments, pixel-ratio cap, …) instead of auto-detecting from the device. `low` / `mid` preview phone-tier shaders on desktop; `mid` keeps the cheap scene but adds 4× MSAA, SMAA, and a 1.5 DPR cap so glass edges stay clean. | [link](https://sc-client-eva.pages.dev/ventanas-take-3/?quality=mid) |
| `fps` | `30` \| `60` \| `120` | Forces the frame rate the adaptive-resolution governor targets (core/refresh-rate.ts), instead of measuring the display at boot. The only way to preview how the governor behaves on a 30fps-capped phone (iOS Low Power Mode, some Android battery savers) from a normal desktop display. | [link](https://sc-client-eva.pages.dev/ventanas-take-3/?quality=low&fps=30) |
| `refresh` | ms, e.g. `33.3` | Same thing as `fps`, written as the period between frames instead of the rate — `refresh=33.3` is `fps=30`. `fps` wins if both are given. | [link](https://sc-client-eva.pages.dev/ventanas-take-3/?quality=low&refresh=33.3) |
| `scrollSource` | `page` \| `sections` \| `sections-webflow` \| `external` | Overrides the "Scroll Source" dropdown — what drives the Theatre.js timeline scrub. | [link](https://sc-client-eva.pages.dev/ventanas-take-3/?scrollSource=external) |

Params combine freely, e.g. [`?dev&quality=low`](https://sc-client-eva.pages.dev/ventanas-take-3/?dev&quality=low).
