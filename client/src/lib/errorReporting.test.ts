import * as Sentry from "@sentry/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startErrorReporting, stopErrorReporting } from "./errorReporting";
import { recordPrivacyConsent } from "./privacyConsent";

// These tests run the REAL Sentry SDK with the REAL options errorReporting.ts
// passes to it, and only swap the network transport for a recorder. A mocked
// `Sentry.init` would pin the shape of the options object but could not notice
// the SDK changing what those options mean — which is exactly what happened in
// v11: `sendDefaultPii` was removed and its replacement, `dataCollection`,
// defaults to collecting everything. What matters is what would leave the
// device, so that is what is asserted.

// @sentry/react does not re-export the envelope types, and @sentry/core is only
// a transitive dependency, so derive them from the public `transport` option.
type Transport = ReturnType<NonNullable<Sentry.BrowserOptions["transport"]>>;
type Envelope = Parameters<Transport["send"]>[0];
type EnvelopeItem = Envelope[1][number];

const sent = vi.hoisted(() => [] as EnvelopeItem[]);

vi.mock("@sentry/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/react")>();
  return {
    ...actual,
    init: (options: Sentry.BrowserOptions) =>
      actual.init({
        ...options,
        transport: () => ({
          send: async (envelope: Envelope) => {
            sent.push(...envelope[1]);
            return {};
          },
          flush: async () => true,
        }),
      }),
  };
});

function sentPayloads(type: string): unknown[] {
  return sent.filter(([header]) => header.type === type).map(([, payload]) => payload);
}

async function captureThroughRealPipeline(error: Error): Promise<Sentry.ErrorEvent> {
  startErrorReporting();
  Sentry.captureException(error);
  await Sentry.flush(2000);
  const events = sentPayloads("event") as Sentry.ErrorEvent[];
  expect(events).toHaveLength(1);
  return events[0];
}

describe("client Sentry init", () => {
  beforeEach(() => {
    sent.length = 0;
    // Breadcrumbs live on the global isolation scope, which outlives each
    // client, so start every test from an empty one.
    Sentry.getIsolationScope().clearBreadcrumbs();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@o0.ingest.sentry.io/0");
    // The privacy-notice gate (S11): nothing initialises until it is acknowledged.
    recordPrivacyConsent();
    globalThis.history.pushState({}, "", "/nutrition?date=2026-09-19&meal=lunch");
  });

  afterEach(async () => {
    stopErrorReporting();
    // stop() closes the client fire-and-forget; wait for that here so a
    // half-closed client can't leak into the next test.
    await Sentry.close();
    vi.unstubAllEnvs();
    globalThis.localStorage.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  it("does not let Sentry infer the athlete's IP or attach identity, cookies or headers", async () => {
    const event = await captureThroughRealPipeline(new Error("boom"));

    // The one SDK-side switch no scrubber can reach: it rides in the SDK
    // metadata, outside the event body, and tells Sentry's relay whether to
    // geolocate the request IP. v11 defaults it to "auto".
    expect(event.sdk?.settings?.infer_ip).toBe("never");
    expect(event.user?.ip_address).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();

    // Session pings carry the IP too when the SDK is allowed to collect it.
    for (const session of sentPayloads("session") as Array<{ attrs?: { ip_address?: string } }>) {
      expect(session.attrs?.ip_address).toBeUndefined();
    }
  });

  it("keeps the PII scrubbers wired in as the second layer", async () => {
    // Start first: addBreadcrumb is a no-op until a client exists, and the
    // breadcrumb must pass through THIS init's beforeBreadcrumb.
    startErrorReporting();
    Sentry.addBreadcrumb({
      category: "fetch",
      data: { url: "/api/v1/foods?q=oats", request_body: '{"bodyWeightKg":"81.4"}' },
    });

    const event = await captureThroughRealPipeline(new Error('400: {"bodyWeightKg":"81.4"}'));

    expect(event.exception?.values?.[0]?.value).toBe("400: [redacted]");
    expect(event.request?.url).toMatch(/\/nutrition\?\[redacted\]$/);
    const fetchCrumb = event.breadcrumbs?.find((crumb) => crumb.category === "fetch");
    expect(fetchCrumb?.data).toEqual({ url: "/api/v1/foods?[redacted]" });
  });
});
