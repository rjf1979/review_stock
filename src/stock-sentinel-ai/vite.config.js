// Vite 构建：源码在 frontend/，产物输出到 frontend/dist，由 server.js 静态伺服。
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'frontend',
  plugins: [vue()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: { '/api': 'http://127.0.0.1:3110' },
  },
});
