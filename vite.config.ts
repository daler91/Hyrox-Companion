import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "logo-primary.svg", "logo-ink.svg", "logo-mono.svg", "mark-currentcolor.svg"],
      manifest: {
        name: "fitai.coach",
        short_name: "fitai",
        description: "AI-powered training planner and analytics for fitness athletes",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#C4F37E",
        icons: [
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "/logo-primary.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/mark-currentcolor.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        cleanupOutdatedCaches: true,
        // Exclude API paths from the SPA navigation fallback so top-level
        // navigations to endpoints like /api/v1/export?format=csv (which
        // return Content-Disposition: attachment) are handled by the browser
        // directly instead of being replaced with the precached index.html —
        // which would otherwise cause wouter to render the NotFound page.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Only apply NetworkFirst to programmatic API requests (XHR/fetch
            // from React Query, whose request.destination is ""). Top-level
            // navigations to /api/* (destination === "document") must bypass
            // the service worker entirely so the browser can process
            // Content-Disposition downloads natively.
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              url.pathname.startsWith("/api/") && request.destination !== "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60,
              },
            },
          },
          {
            urlPattern:
              /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "font-cache",
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: /\.(?:woff2?|ttf|otf|eot)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "font-cache",
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp)$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "image-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
    sentryVitePlugin({
      authToken: sentryAuthToken,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT_CLIENT,
      telemetry: false,
      disable: !sentryAuthToken,
      sourcemaps: {
        filesToDeleteAfterUpload: ["./dist/public/**/*.map"],
      },
    }),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        // Rolldown 1.1+ deprecates `advancedChunks` in favour of `codeSplitting`
        // (identical group shape; advancedChunks is silently IGNORED when both
        // are set, so this must be a rename, never a duplicate). Each group
        // keeps the original chunk name and matches by node_modules path.
        codeSplitting: {
          groups: [
            // MUST claim clsx/tailwind-merge before vendor-charts (priority
            // beats the default 0): groups capture their matched package's
            // dependencies recursively, and clsx is both a recharts dep and a
            // direct app dep (cn() in client/src/lib/utils.ts, imported by the
            // eager UI shell). Without this group, clsx lands inside
            // vendor-charts and the entry statically imports the ~390KB charts
            // chunk on every first paint — including the signed-out Landing
            // page, which renders no charts (all recharts sites are lazy
            // routes). Guarded by script/bundle-check.ts.
            { name: "vendor-clsx", test: /[\\/]node_modules[\\/](?:clsx|tailwind-merge)[\\/]/, priority: 10 },
            { name: "vendor-react", test: /[\\/]node_modules[\\/](?:react-dom|react|wouter)[\\/]/ },
            { name: "vendor-ui", test: /[\\/]node_modules[\\/]lucide-react[\\/]/ },
            { name: "vendor-query", test: /[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/ },
            { name: "vendor-charts", test: /[\\/]node_modules[\\/]recharts[\\/]/ },
            { name: "vendor-dnd", test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
