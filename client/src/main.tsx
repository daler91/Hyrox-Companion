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
import { migrateLegacyKeys } from "./lib/storageMigration";

migrateLegacyKeys();

const emomBuilderEnabled = (import.meta.env.VITE_EMOM_BUILDER_ENABLED as string | undefined) === "true";
if (!import.meta.env.PROD) {
  console.warn("[startup-config]", {
    mode: import.meta.env.MODE,
    emomBuilderEnabled,
  });
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN as string,
    environment: import.meta.env.MODE,
    // The Sentry Vite plugin injects SENTRY_RELEASE into the bundle at build
    // time when SENTRY_AUTH_TOKEN is configured. VITE_SENTRY_RELEASE is an
    // optional manual override; both resolve to undefined in dev/contributor
    // builds (Sentry buckets such events as releaseless, which is fine).
    release:
      (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) ??
      (import.meta.env.SENTRY_RELEASE as string | undefined),
    sendDefaultPii: false,
  });
}

import { registerSW } from "virtual:pwa-register";

const shouldRegisterServiceWorkers =
  !("Cypress" in globalThis) && "serviceWorker" in globalThis.navigator;

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={FallbackErrorBoundary}>
    <App />
  </Sentry.ErrorBoundary>
);

// Register service worker for PWA support
if (shouldRegisterServiceWorkers) {
  registerSW({
    onNeedRefresh() {
      // A new version is available - the user can refresh when ready
    },
    onOfflineReady() {
      // The app is ready to work offline
    },
  });
}

// Register push notification service worker (separate scope from Workbox SW)
if (shouldRegisterServiceWorkers) {
  void globalThis.navigator.serviceWorker.register("/sw-push.js");
}
