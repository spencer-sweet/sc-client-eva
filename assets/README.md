# Assets

Source media used by the scene and the Webflow site. This folder is the library, not a live app dependency — copy or export files into `ventanas-take-3/public` (or upload directly to Webflow) as needed.

Deployed as a static directory listing alongside the other sites: https://sc-client-eva.pages.dev/assets/

## Contents

| Folder | What's in it |
| --- | --- |
| `4-pointed-star/` | The 4-pointed-star SVG used for the windows scene, plus source `.af` (Affinity Designer) file and earlier draft passes. |
| `star-shatter/` | Star-shatter GLBs — the exploding star model at various fragment counts and edge styles (`clean/` = clean breaks, `jagged/` = jagged fragments). |
| `Rive Animations/` | `.riv` animation files used elsewhere on the Webflow site. |

## Note

`build.sh` copies this folder into `dist/assets/` verbatim and generates a browsable `index.html` for every directory in it, so new files or subfolders show up automatically on the next deploy — no build config changes needed.
