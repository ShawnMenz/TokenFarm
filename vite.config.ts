import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The displayed version comes straight from package.json so the badge in the UI
// and the package version can never drift apart.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Front-end lives in web/. During dev, Vite serves it on :5173 and proxies the
// game API (/events SSE + /action/*) to the Node server on :8787.
export default defineConfig({
  root: 'web',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      '/events': { target: 'http://localhost:8787', changeOrigin: true },
      '/action': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
  },
});
