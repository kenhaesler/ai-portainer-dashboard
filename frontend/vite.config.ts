import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5273,
    proxy: {
      '/api': {
        target: 'http://localhost:3051',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3051',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3051',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
