import { fileURLToPath } from 'node:url'

const APP_VERSION = '1.0.0'

// Everything the app serves hangs off this prefix, so the manifest link and
// the service-worker scope have to be built from it too.
const BASE_URL = process.env.NUXT_APP_BASE_URL || '/'
const withBase = (path: string) => `${BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  srcDir: 'src/',
  ssr: false,

  devtools: { enabled: false },

  modules: ['@pinia/nuxt', '@vite-pwa/nuxt'],

  typescript: {
    strict: true,
    typeCheck: false,
  },

  runtimeConfig: {
    public: {
      appVersion: APP_VERSION,
    },
  },

  app: {
    // Relative base so the built app can be served from any sub-path
    // (file:// style hosting, GitHub Pages, a LAN folder, …).
    baseURL: BASE_URL,
    head: {
      htmlAttrs: { lang: 'ru' },
      title: 'Dentora',
      meta: [
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content:
            'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5',
        },
        { name: 'description', content: 'Локальная база клиентов, работ и снимков. Работает офлайн.' },
        { name: 'theme-color', content: '#0f172a' },
        // iOS standalone behaviour
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Dentora' },
        { name: 'format-detection', content: 'telephone=no' },
      ],
      link: [
        // `@vite-pwa/nuxt` does not inject this into the shell when `ssr` is
        // false, and without it Chrome offers no install prompt and iOS
        // ignores the app metadata. So we declare it ourselves.
        { rel: 'manifest', href: withBase('manifest.webmanifest') },
        { rel: 'icon', href: withBase('icons/favicon.svg'), type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: withBase('icons/apple-touch-icon.png'), sizes: '180x180' },
        { rel: 'mask-icon', href: withBase('icons/favicon.svg'), color: '#0ea5e9' },
      ],
    },
  },

  css: ['~/assets/css/main.css'],

  pwa: {
    registerType: 'prompt',
    strategies: 'generateSW',
    manifest: {
      id: BASE_URL,
      name: 'Dentora — база клиентов',
      short_name: 'Dentora',
      description:
        'Локальное офлайн-приложение для ведения клиентов, работ, рентгенов и документов.',
      lang: 'ru',
      dir: 'ltr',
      theme_color: '#0f172a',
      background_color: '#0f172a',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      orientation: 'any',
      scope: BASE_URL,
      start_url: BASE_URL,
      categories: ['medical', 'productivity', 'utilities'],
      icons: [
        { src: withBase('icons/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: withBase('icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: withBase('icons/maskable-192.png'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: withBase('icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'Новый клиент', url: withBase('clients/new') },
        { name: 'Backup', url: withBase('backup') },
      ],
    },
    workbox: {
      // The whole app shell is precached, so the app boots with no network.
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      navigateFallback: BASE_URL,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: false,
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
    client: {
      installPrompt: true,
      periodicSyncForUpdates: 3600,
    },
    devOptions: {
      enabled: false,
      type: 'module',
      navigateFallback: '/',
    },
  },

  nitro: {
    prerender: {
      crawlLinks: false,
      routes: ['/'],
    },
  },

  vite: {
    build: {
      target: 'es2020',
    },
    resolve: {
      alias: {
        '~db': fileURLToPath(new URL('./src/database', import.meta.url)),
      },
    },
  },
})
