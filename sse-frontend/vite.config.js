import {
  defineConfig
} from "vite";

import react from
  "@vitejs/plugin-react";

import {
  VitePWA
} from "vite-plugin-pwa";

export default defineConfig({
  server:{
    host:true,
    allowedHosts:["unfaintly-thiolacetic-melisa.ngrok-free.dev"]
  },
  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",

      /*
        Required when testing using:
        npm run dev
      */
      devOptions: {
        enabled: true
      },

      includeAssets: [
        "pwa-192x192.png",
        "pwa-512x512.png",
        "maskable-512x512.png",
        "apple-touch-icon.png"
      ],

      manifest: {
        id: "/",

        name:
          "Packaging Queue",

        short_name:
          "Packaging",

        description:
          "Realtime packaging queue and order tracking system.",

        start_url: "/",
        scope: "/",

        display: "standalone",

        orientation: "any",

        background_color:
          "#f3f4f6",

        theme_color:
          "#1565c0",

        categories: [
          "business",
          "productivity"
        ],

        icons: [
          {
            src:
              "/pwa-192x192.png",

            sizes:
              "192x192",

            type:
              "image/png",

            purpose:
              "any"
          },
          {
            src:
              "/pwa-512x512.png",

            sizes:
              "512x512",

            type:
              "image/png",

            purpose:
              "any"
          },
          {
            src:
              "/maskable-512x512.png",

            sizes:
              "512x512",

            type:
              "image/png",

            purpose:
              "maskable"
          }
        ]
      },

      workbox: {
        cleanupOutdatedCaches:
          true,

        clientsClaim: true,
        skipWaiting: true,

        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webp,woff,woff2}"
        ],

        /*
          Return index.html when opening
          the installed application.
        */
        navigateFallback:
          "/index.html",

        /*
          Do not cache the approvals API.
          It must always retrieve current data.
        */
        runtimeCaching: []
      }
    })
  ]
});