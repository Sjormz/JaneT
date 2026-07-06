import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react';
          }
          if (
            id.includes('node_modules/@xterm/xterm/') ||
            id.includes('node_modules/@xterm/addon-fit/') ||
            id.includes('node_modules/@xterm/addon-search/') ||
            id.includes('node_modules/@xterm/addon-unicode11/') ||
            id.includes('node_modules/@xterm/addon-web-links/')
          ) {
            return 'xterm';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons';
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
