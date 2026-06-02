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
import { setupErrorReporting } from "./lib/errorReporting";
import { migrateLegacyKeys } from "./lib/storageMigration";

migrateLegacyKeys();

const emomBuilderEnabled = (import.meta.env.VITE_EMOM_BUILDER_ENABLED as string | undefined) === "true";
if (!import.meta.env.PROD) {
  console.warn("[startup-config]", {
    mode: import.meta.env.MODE,
    emomBuilderEnabled,
  });
}

// S11: defer Sentry.init until the user has acknowledged the privacy notice
// banner (and honor the per-processor opt-out). Nothing is captured before the
// notice is seen; the Settings toggle applies immediately. See errorReporting.ts.
setupErrorReporting();

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
