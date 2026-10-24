import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The version shown in the settings screen: package version, build date and commit.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout */
}
const built = new Date().toISOString().slice(0, 10);

// The site is served from https://<user>.github.io/exam-reader/
export default defineConfig({
  base: '/exam-reader/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify([built, commit].filter(Boolean).join(' · ')),
  },
  // Compile for older iPads too (Safari 12+), not only the newest browsers.
  build: { target: ['es2017', 'safari12', 'ios12'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'מבחן בקול',
        short_name: 'מבחן בקול',
        description: 'מבחן עם הקראה ותשובה בעל-פה',
        lang: 'he',
        dir: 'rtl',
        display: 'standalone',
        orientation: 'any',
        background_color: '#fbf7ee',
        theme_color: '#fbf7ee',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything is precached so the app opens in airplane mode.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // Take over the open page right away, so everything works offline from the first visit.
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
