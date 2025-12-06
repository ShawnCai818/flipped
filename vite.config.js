import { defineConfig } from 'vite';

export default defineConfig({
  base: '/flipped/', // 这里对应你的项目名
  build: {
    chunkSizeWarningLimit: 1600,
  },
});