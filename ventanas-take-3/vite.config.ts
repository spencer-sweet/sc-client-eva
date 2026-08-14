import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Port is pinned here (not via CLI args) so the dev server always binds the
// port the launcher expects. strictPort makes a conflict fail loudly instead
// of silently drifting to another port.
export default defineConfig({
  // es2022: top-level await in main.ts (bootDevHelpers before touching DOM).
  // Required for Webflow embeds where the module can run before <body> exists.
  build: {
    target: 'es2022',
  },
  server: {
    port: 5206,
    strictPort: true,
    fs: {
      allow: [root, path.resolve(root, '../assets')],
    },
  },
  preview: {
    port: 4186,
    strictPort: true,
  },
});
