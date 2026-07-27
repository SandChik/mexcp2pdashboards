import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      // Version probe lives outside /api — proxy it too so the dev server can
      // report the backend version instead of showing "gagal dibaca".
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
