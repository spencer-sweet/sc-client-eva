import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Port is pinned here (not via CLI args) so the dev server always binds the
// port the launcher expects. strictPort makes a conflict fail loudly instead
// of silently drifting to another port.
export default defineConfig({
  // Self-signed cert so Webflow (HTTPS) can load the local module without mixed content.
  plugins: [basicSsl()],
  // es2022: top-level await in main.ts (bootDevHelpers before touching DOM).
  // Required for Webflow embeds where the module can run before <body> exists.
  build: {
    target: 'es2022',
  },
  server: {
    port: 5206,
    strictPort: true,
    // Webflow loads these modules cross-origin; the default CORS middleware is
    // easy to miss on the HTTPS plugin stack, so allow the EVA hosts explicitly
    // and also stamp ACAO on every response.
    origin: 'https://localhost:5206',
    cors: {
      origin: [
        'https://eva-networks-staging.webflow.io',
        'https://evanetworks.com',
        'https://www.evanetworks.com',
        'https://localhost:5206',
      ],
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    fs: {
      allow: [root, path.resolve(root, '../assets')],
    },
  },
  preview: {
    port: 4186,
    strictPort: true,
  },
});
