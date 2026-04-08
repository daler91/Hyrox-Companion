import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/500.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./index.css";

import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { FallbackErrorBoundary } from "./components/FallbackErrorBoundary";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN as string,
  });
}

import { registerSW } from "virtual:pwa-register";

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={FallbackErrorBoundary}>
    <App />
  </Sentry.ErrorBoundary>
);

// Register service worker for PWA support
registerSW({
  onNeedRefresh() {
    // A new version is available - the user can refresh when ready
  },
  onOfflineReady() {
    // The app is ready to work offline
  },
});

// Register push notification service worker (separate scope from Workbox SW)
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw-push.js");
}
