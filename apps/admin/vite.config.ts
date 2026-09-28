import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt": a new version never swaps itself in the middle of a shift; staff choose when to update.
      registerType: 'prompt',
      // injectManifest: a hand-written service worker (src/sw.ts) that also handles Web Push — generateSW cannot add
      // custom event listeners, and this feature needs one for the "push" and "notificationclick" events.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'pwa-192.png'],
      manifest: {
        name: 'مطبعة المصطفى - الإدارة',
        short_name: 'المصطفى',
        description: 'Staff app for Al-Mustafa Print (works offline)',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#101418',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // App shell only. Business data lives in IndexedDB (src/offline), never in the HTTP cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
})
