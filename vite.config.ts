import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

import { bundleStatsPlugin } from "./script/bundleStats";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

/**
 * Whether a build asset is a font file. Fonts are never inlined into CSS as
 * base64: inlined, every small subset rode in the render-blocking entry
 * stylesheet (about 64 KB) whether or not the page needed its glyphs, where a
 * file is fetched only when its unicode-range is used.
 * PF6 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function isFontAsset(filePath: string): boolean {
  return /\.(?:woff2?|ttf|otf|eot)$/i.test(filePath);
}

/**
 * What the service worker precaches. Fonts are limited to the woff2 files of
 * the latin subset (`<family>-latin-<weight>-…`), which is what an English page
 * renders with. Every other subset (latin-ext, cyrillic, vietnamese, …) and
 * every woff fallback used to be precached too: 118 files, 1.48 MB, on each
 * new service-worker install. They are runtime-cached on first use instead
 * (the font-cache rule below). PF6 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const PRECACHE_GLOB_PATTERNS = ["**/*.{js,css,html,ico,png,svg}", "**/*-latin-[0-9]*.woff2"];

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "favicon.svg",
        "logo-primary.svg",
        "logo-ink.svg",
        "logo-mono.svg",
        "mark-currentcolor.svg",
        "icon-192.png",
        "icon-512.png",
        "icon-maskable-512.png",
        "apple-touch-icon.png",
      ],
      manifest: {
        name: "fitai.coach",
        short_name: "fitai",
        description: "AI-powered training planner and analytics for fitness athletes",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#C4F37E",
        // Raster icons for the install prompt and home screen. Android needs
        // 192/512 PNGs to offer "Install app" rather than a plain shortcut,
        // and the maskable one is full-bleed brand green so the adaptive
        // icon mask never shows a transparent ring around the mark.
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: PRECACHE_GLOB_PATTERNS,
        cleanupOutdatedCaches: true,
        // Pull the push handlers into the generated Workbox service worker
        // instead of registering sw-push.js as a second worker. Both used the
        // default scope "/", so the second registration replaced the first and
        // the app silently lost either offline caching or push delivery
        // depending on registration order. importScripts gives one worker that
        // owns both, which is also what navigator.serviceWorker.ready (used by
        // the push subscribe flow) expects to resolve to.
        importScripts: ["sw-push.js"],
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
            //
            // Cached API bodies are personal data held in Cache Storage keyed by
            // URL only — there is no per-user partition — so `clearUserLocalData`
            // (client/src/lib/userLocalData.ts) deletes the whole `api-cache` on
            // sign-out and on account deletion. Identity and bulk-export
            // endpoints are excluded outright: they are worthless offline and are
            // the two that most directly identify the athlete.
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              url.pathname.startsWith("/api/") &&
              !url.pathname.startsWith("/api/v1/auth/") &&
              !url.pathname.startsWith("/api/v1/export") &&
              request.destination !== "document",
            // No `networkTimeoutSeconds`: the cache answers only when the
            // network actually fails (offline, connection refused). With a 10 s
            // timeout a slow refetch after a save got the pre-save response,
            // which React Query then held for its stale time, so the
            // just-logged workout looked missing. A hung request is still
            // bounded by the API client's own timeout. C53
            // (CODEBASE_ANALYSIS_2026-10-03)
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
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
    // Records the eager-icon count script/bundle-check.ts guards (PF19).
    bundleStatsPlugin(),
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
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: "hidden",
    // undefined keeps Vite's own rule (inline below 4 KiB) for everything else.
    assetsInlineLimit: (filePath: string) => (isFontAsset(filePath) ? false : undefined),
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
            // No group for lucide-react: each icon is its own module, and a
            // `vendor-ui` group gathered every icon used anywhere into one
            // chunk the eager shell imports, so first paint (the signed-out
            // Landing page too) loaded the ~140 icons of the lazy routes. Left
            // ungrouped, an icon ships with the chunk that uses it. Guarded by
            // script/bundle-check.ts. PF19 (CODEBASE_ANALYSIS_2026-10-03)
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
