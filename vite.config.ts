import { cfbBrowserExport } from './build/cfb-browser.ts';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
// https://vite.dev/guide/build.html#relative-base
export default defineConfig({
  base: './',
  plugins: [react(), cfbBrowserExport()],
  worker: { plugins: () => [cfbBrowserExport()] },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1' },
  build: { outDir: 'dist', sourcemap: false },
});
