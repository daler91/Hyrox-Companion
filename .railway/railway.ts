import { defineRailway, github, preserve, project, service } from "railway/iac";

// Railway Infrastructure as Code for the production service. It replaced
// railway.toml (Config as Code), which Railway stopped reading on 2026-12-01.
// Started from `railway config migrate`, which carried over the build and
// start commands and the healthcheck but dropped the builder, drainingSeconds
// and the restart policy; those are restored below.
//
// Editing this file changes nothing on its own: run `railway config plan`, then
// `railway config apply`, from a checkout linked to the service. The
// "Railway deploy config" tests in server/bootstrap/startup.test.ts evaluate it.

// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "Hyrox-Companion";

export default defineRailway(() => {
  const HyroxCompanion = service("Hyrox-Companion", {
    source: github("daler91/Hyrox-Companion", { checkSuites: false }),
    build: {
      // nixpacks reads nixpacks.toml, whose install phase replaces the default
      // one so dependency install scripts never run here either. Left unset,
      // the builder would be Railway's default instead, which ignores that file.
      builder: "NIXPACKS",
      // --ignore-scripts (S4, CODEBASE_ANALYSIS_2026-10-03): Railway puts every
      // service variable (DATABASE_URL, ENCRYPTION_KEY, provider keys) in the
      // build environment, so a compromised dependency's postinstall would run
      // here with all of them. Every CI workflow installs the same way. No
      // package needs its script: esbuild and @sentry/cli resolve their platform
      // binaries from optional dependencies, and bufferutil loads its bundled
      // prebuild (or its JS fallback).
      buildCommand: "pnpm install --frozen-lockfile --ignore-scripts && pnpm run build",
    },
    start: "node script/start.js",
    // Readiness, not liveness (D2). Railway polls this path only while a
    // deploy rolls out: the first 2xx makes the new deployment active and
    // retires the old one, and it is never polled after go-live.
    // /api/v1/health answers 503 until boot has reached the DB and mounted
    // every route, and for good if boot fails, so a broken release fails its
    // deploy while the previous one keeps serving.
    healthcheck: "/api/v1/health",
    // A healthy boot is ready in seconds; the slowest legitimate path is the
    // DB connect retry in server/maintenance.ts (~54 s at worst).
    healthcheckTimeout: 120,
    deploy: {
      // SIGTERM-to-SIGKILL grace for the outgoing deployment (D3). Railway's
      // default is 0 s, which killed the old instance before
      // registerShutdownHandlers (server/bootstrap/lifecycle.ts) could drain
      // SSE, stop pg-boss or flush Sentry. 65 s covers its 60 s
      // SHUTDOWN_TIMEOUT_MS, so the app's own force-exit fires first.
      drainingSeconds: 65,
      // The restart policy is Railway's default, On Failure, which Railway
      // stores as null: declaring restartPolicyType: "ON_FAILURE" left
      // `railway config plan` reporting a change after every apply.
      restartPolicyMaxRetries: 3,
    },
    replicas: { "us-east4-eqdc4a": 1 },
    domains: ["fitai.coach"],
    networking: { privateNetworkEndpoint: "hyrox-companion" },
    // preserve() keeps each variable's current value in Railway; secrets never
    // live in this file.
    env: {
      AI_TEXT_MODEL: preserve(),
      AI_TEXT_OPENAI_COMPATIBLE_PROFILE: preserve(),
      AI_TEXT_PROVIDER: preserve(),
      APP_URL: preserve(),
      CLERK_PUBLISHABLE_KEY: preserve(),
      CLERK_SECRET_KEY: preserve(),
      CRON_SECRET: preserve(),
      CSRF_SECRET: preserve(),
      DATABASE_URL: preserve(),
      EDAMAM_APP_ID: preserve(),
      EDAMAM_APP_KEY: preserve(),
      ENCRYPTION_KEY: preserve(),
      GEMINI_API_KEY: preserve(),
      NIXPACKS_SPA_CADDY: preserve(),
      NODE_ENV: preserve(),
      NODE_OPTIONS: preserve(),
      RESEND_API_KEY: preserve(),
      RESEND_FROM_EMAIL: preserve(),
      SENTRY_AUTH_TOKEN: preserve(),
      SENTRY_DSN: preserve(),
      SENTRY_ORG: preserve(),
      SENTRY_PROJECT_CLIENT: preserve(),
      SENTRY_PROJECT_SERVER: preserve(),
      SPOONACULAR_API_KEY: preserve(),
      STRAVA_CLIENT_ID: preserve(),
      STRAVA_CLIENT_SECRET: preserve(),
      STRAVA_STATE_SECRET: preserve(),
      USDA_API_KEY: preserve(),
      VECTOR_DATABASE_URL: preserve(),
      VITE_CLERK_PUBLISHABLE_KEY: preserve(),
      VITE_SENTRY_DSN: preserve(),
      XAI_API_KEY: preserve(),
    },
  });

  return project("FitAi Coach", {
    resources: [HyroxCompanion],
  });
});
