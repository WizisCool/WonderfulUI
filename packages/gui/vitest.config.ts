import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@wonderful-ui/parser': resolve(__dirname, '..', 'parser', 'src', 'index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.component.test.ts'],
    globals: false,
  },
});
