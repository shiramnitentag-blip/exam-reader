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
// One id per build: the app, version.json and the service worker guard all carry it.
const buildId = `${pkg.version}-${commit || 'local'}-${Date.now().toString(36)}`;

/**
 * Manual updates. version.json tells the settings screen which build is on the server.
 * sw-guard.js runs first in the service worker: a new version installs only on the very first
 * visit, or when the teacher approved exactly this build (src/update.ts registers
 * "sw.js?g=1&approved=<build>"). Any other new version is turned away at once, so the installed
 * app never changes by itself, not even after it is closed and opened again. ("g" marks the
 * guarded era: a version installed before manual updates existed is replaced once, the old way.)
 */
const swGuard = `const BUILD = ${JSON.stringify(buildId)};
self.addEventListener('install', (event) => {
  const params = new URL(self.location.href).searchParams;
  if (!self.registration.active) return; // first install
  // Coming from a version from before manual updates (registered without "g"): switch over once.
  if (!params.has('g')) {
    self.skipWaiting();
    return;
  }
  if (params.get('approved') === BUILD) {
    self.skipWaiting();
    return;
  }
  event.stopImmediatePropagation(); // nothing is downloaded
  event.waitUntil(Promise.reject(new Error('update not approved by the teacher')));
});
`;
const manualUpdates = {
  name: 'manual-updates',
  generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId, version: pkg.version }) });
    this.emitFile({ type: 'asset', fileName: 'sw-guard.js', source: swGuard });
  },
};

// The site is served from https://<user>.github.io/exam-reader/
export default defineConfig({
  base: '/exam-reader/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify([built, commit].filter(Boolean).join(' · ')),
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  // Compile for older iPads too (Safari 12+), not only the newest browsers.
  build: { target: ['es2017', 'safari12', 'ios12'] },
  plugins: [
    react(),
    manualUpdates,
    VitePWA({
      // Updates are manual: a new version waits until the teacher taps "update now" in the settings
      // (src/update.ts). The student side never changes version on its own.
      registerType: 'prompt',
      injectRegister: false,
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
        // The first install takes over the open page right away, so it works offline from the first
        // visit. A newer version waits (no skipWaiting) until the teacher asks for it.
        clientsClaim: true,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        importScripts: ['sw-guard.js'],
      },
    }),
  ],
});
