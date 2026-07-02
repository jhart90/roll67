import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, proxy Socket.IO + REST + uploads to the Express server so the client
// can use same-origin requests (no CORS, matches production behaviour).
export default defineConfig({
  plugins: [react()],
  // Ensure a single React instance across the workspace (zustand + react both consume it).
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true, changeOrigin: true },
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
