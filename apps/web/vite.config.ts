import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The platform front end is served from 127.0.0.1 in development. Student content will be
// served from *.localhost by the content server (a different site; see ADR-001).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Keep the browser's Origin header so the API's CSRF check sees the real origin.
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
});
