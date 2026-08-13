import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@jsquash/oxipng'],
  },
  worker: {
    format: 'es',
  },
});
