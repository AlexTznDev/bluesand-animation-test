import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      formats: ['iife'],
      name: 'BluesandAnim',
      fileName: () => 'bluesand-anim.js',
    },
    outDir: 'dist',
    cssCodeSplit: false,
  },
});
