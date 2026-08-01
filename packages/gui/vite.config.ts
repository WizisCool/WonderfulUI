import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [vue()],
  root: '.',
  clearScreen: false,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@wonderful-ui/parser': resolve(__dirname, '..', 'parser', 'src', 'index.ts'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    // Dev server already provides mapped source. Shipping .map files only
    // enlarges the offline Tauri payload and exposes application source.
    sourcemap: false,
  },
});
