import { defineConfig } from 'vite';

// Port is pinned here (not via CLI args) so the dev server always binds the
// port the launcher expects. strictPort makes a conflict fail loudly instead
// of silently drifting to another port.
export default defineConfig({
  server: {
    port: 5195,
    strictPort: true,
  },
});
