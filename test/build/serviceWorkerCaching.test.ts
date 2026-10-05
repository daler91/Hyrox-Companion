// @vitest-environment node
/**
 * Pins the service worker's runtime caching rule for API GETs.
 *
 * The rule lives in `vite.config.ts` and is only exercised by a production
 * build in a browser, so nothing else notices when it drifts. The plugins are
 * mocked so importing the config is side-effect free; the PWA mock hands back
 * the options it was given, which is the generated worker's whole input.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("vite-plugin-pwa", () => ({
  VitePWA: (options: unknown) => ({ name: "vite-plugin-pwa-mock", options }),
}));
vi.mock("@sentry/vite-plugin", () => ({ sentryVitePlugin: () => ({ name: "sentry-mock" }) }));
vi.mock("@tailwindcss/vite", () => ({ default: () => ({ name: "tailwind-mock" }) }));
vi.mock("@vitejs/plugin-react", () => ({ default: () => ({ name: "react-mock" }) }));

interface RuntimeCachingRule {
  urlPattern: unknown;
  handler: string;
  options?: { cacheName?: string; networkTimeoutSeconds?: number };
}

async function loadApiRule(): Promise<RuntimeCachingRule> {
  const { default: config } = await import("../../vite.config");
  const plugins = (config.plugins ?? []) as { name?: string; options?: unknown }[];
  const pwa = plugins.find((plugin) => plugin.name === "vite-plugin-pwa-mock");
  const options = pwa?.options as
    { workbox?: { runtimeCaching?: RuntimeCachingRule[] } } | undefined;
  const rule = options?.workbox?.runtimeCaching?.find(
    (entry) => entry.options?.cacheName === "api-cache",
  );
  if (!rule) throw new Error("vite.config.ts has no api-cache runtime caching rule");
  return rule;
}

function matches(rule: RuntimeCachingRule, pathname: string, destination: string): boolean {
  const pattern = rule.urlPattern as (context: {
    url: URL;
    request: { destination: string };
  }) => boolean;
  return pattern({ url: new URL(pathname, "https://app.example"), request: { destination } });
}

describe("service worker API caching", () => {
  it("is network-first and falls back to the cache only when the network fails", async () => {
    // C53 (CODEBASE_ANALYSIS_2026-10-03): a 10 s network timeout served the
    // pre-save response to a slow refetch after a save, and React Query kept it.
    const rule = await loadApiRule();
    expect(rule.handler).toBe("NetworkFirst");
    expect(rule.options?.networkTimeoutSeconds).toBeUndefined();
  });

  it("covers programmatic API reads but not navigations, identity or export", async () => {
    const rule = await loadApiRule();
    expect(matches(rule, "/api/v1/timeline", "")).toBe(true);
    expect(matches(rule, "/api/v1/export?format=csv", "document")).toBe(false);
    expect(matches(rule, "/api/v1/workouts", "document")).toBe(false);
    expect(matches(rule, "/api/v1/auth/user", "")).toBe(false);
    expect(matches(rule, "/api/v1/export", "")).toBe(false);
  });
});
