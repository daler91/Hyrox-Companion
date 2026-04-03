import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const CACHE_MAX_AGE_SECONDS = 86400; // 24 hours

function apiCacheRule(urlPattern: RegExp, cacheName: string, handler: "StaleWhileRevalidate" | "NetworkFirst", maxEntries = 20) {
  return { urlPattern, handler, options: { cacheName, expiration: { maxEntries, maxAgeSeconds: CACHE_MAX_AGE_SECONDS } } };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "fitai.coach",
        short_name: "fitai",
        description: "AI-powered training planner and analytics for fitness athletes",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        runtimeCaching: [
          apiCacheRule(/^\/api\/v1\/plans/, "api-plans", "StaleWhileRevalidate"),
          apiCacheRule(/^\/api\/v1\/timeline/, "api-timeline", "NetworkFirst", 50),
          apiCacheRule(/^\/api\/v1\/personal-records/, "api-analytics", "StaleWhileRevalidate"),
          apiCacheRule(/^\/api\/v1\/workouts/, "api-workouts", "NetworkFirst", 50),
        ],
      },
    }),
  ],
  resolve: {
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
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "wouter"],
          "vendor-ui": ["lucide-react"],
          "vendor-query": ["@tanstack/react-query"],
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
