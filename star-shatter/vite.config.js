import { defineConfig } from 'vite';

// Port comes from the PORT env var (set by the launcher via autoPort) with
// 5201 as a local-CLI fallback. strictPort still fails loudly on a genuine
// conflict rather than silently drifting to a different port.
export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5201,
    strictPort: true,
  },
});
