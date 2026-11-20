// Only the families index.css's font stacks name (Geist, Geist Mono, Space
// Grotesk): every face imported here is emitted, and its latin subset is
// precached by the service worker. Open Sans was imported but never used.
// PF6 (CODEBASE_ANALYSIS_2026-10-03)
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
import { rootErrorHandlers } from "./lib/rootErrorHandlers";
import { registerServiceWorker } from "./lib/serviceWorkerUpdate";
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

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html has no #root element to render into");

// The root error callbacks report to Sentry; see rootErrorHandlers for why a
// boundary-caught error is reported once, by its boundary.
createRoot(rootElement, rootErrorHandlers).render(
  <Sentry.ErrorBoundary fallback={FallbackErrorBoundary}>
    <App />
  </Sentry.ErrorBoundary>
);

// Register the service worker for PWA support; a new build prompts a reload.
if (shouldRegisterServiceWorkers) {
  registerServiceWorker(registerSW);
}

// Push notifications are handled by the SAME service worker: the Workbox config
// importScripts("sw-push.js") in vite.config.ts pulls the push/notificationclick
// listeners into the generated worker. Registering sw-push.js separately here
// used the default scope "/" as well, so it replaced the Workbox registration
// (or was replaced by it) and one of the two features silently stopped working.
