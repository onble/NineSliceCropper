import { defineConfig } from 'vite';

export default defineConfig({
  // Keep worker/WASM URLs relative so static hosts can serve the app from a
  // project subdirectory instead of requiring it at the domain root.
  base: './',
  optimizeDeps: {
    exclude: ['@jsquash/oxipng'],
  },
  worker: {
    format: 'es',
  },
});
