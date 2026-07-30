import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Port is pinned here (not via CLI args) so the dev server always binds the
// port the launcher expects. strictPort makes a conflict fail loudly instead
// of silently drifting to another port.
export default defineConfig({
  server: {
    port: 5204,
    strictPort: true,
    // clean/jagged GLBs live in the repo's shared assets/ folder (one level up);
    // Vite blocks that by default, so allow it for /@fs imports in DEV
    fs: {
      allow: [root, path.resolve(root, '../assets')],
    },
  },
  // same reasoning for `vite preview` -- pnpm swallows `-- --port` style args,
  // so the production-build check needs its port pinned here too
  preview: {
    port: 4184,
    strictPort: true,
  },
});
