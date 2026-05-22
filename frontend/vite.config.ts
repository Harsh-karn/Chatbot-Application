import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration targeting port 3000 for frontend dev server
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5005',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
