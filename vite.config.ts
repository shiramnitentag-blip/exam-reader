import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The site is served from https://<user>.github.io/exam-reader/
export default defineConfig({
  base: '/exam-reader/',
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
