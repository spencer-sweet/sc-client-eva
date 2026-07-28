import { defineConfig } from 'vite';

// Port is pinned here (not via CLI args) so the dev server always binds the
// port the launcher expects. strictPort makes a conflict fail loudly instead
// of silently drifting to another port.
export default defineConfig({
  server: {
    port: 5203,
    strictPort: true,
  },
  // same reasoning for `vite preview` -- pnpm swallows `-- --port` style args,
  // so the production-build check needs its port pinned here too
  preview: {
    port: 4183,
    strictPort: true,
  },
});
