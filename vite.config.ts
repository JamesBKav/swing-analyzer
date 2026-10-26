import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the site from /<repo>/. Override with BASE_PATH if needed
// (e.g. BASE_PATH=/ for a custom domain).
const base = process.env.BASE_PATH ?? '/swing-analyzer/';

export default defineConfig({
  base,
  worker: { format: 'es' },
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        name: 'Swing Analyzer',
        short_name: 'Swing',
        description: 'Offline golf swing analysis with on-device pose estimation',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache everything, including the ~13 MB wasm and both pose models,
        // so analysis works with no network at all.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,task,webmanifest}'],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
