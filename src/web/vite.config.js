import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  base: '/assets/',
  plugins: [vue()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  root: 'client',
  build: {
    assetsInlineLimit: () => false,
    outDir: path.resolve(__dirname, 'public/assets'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'client/src/main.js'),
      formats: ['es'],
      fileName: () => 'app.js'
    },
    rollupOptions: {
      output: {
        assetFileNames(assetInfo) {
          if (assetInfo.names?.some((name) => name.endsWith('.css'))) return 'app[extname]';
          return '[name]-[hash][extname]';
        }
      }
    }
  }
});
