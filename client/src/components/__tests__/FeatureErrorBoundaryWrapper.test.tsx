import * as Sentry from "@sentry/react";
import { render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rootErrorHandlers } from "@/lib/rootErrorHandlers";

import { FeatureErrorBoundaryWrapper } from "../FeatureErrorBoundaryWrapper";

function Boom(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'map')");
}

/** A boundary that is not Sentry's, so nothing reports for it but the root. */
class PlainBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>plain fallback</p> : this.props.children;
  }
}

/**
 * Tech debt #56: a feature boundary passed nothing to Sentry, so its reports
 * carried no feature. Tagging it alone was not enough: React 19 hands every
 * caught error to the root onCaughtError first, and Sentry's duplicate filter
 * then dropped the boundary's tagged copy. Real Sentry client, with only its
 * duplicate filter, and events captured in beforeSend.
 */
describe("feature error boundary reports", () => {
  let events: Sentry.ErrorEvent[];

  beforeEach(() => {
    events = [];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    Sentry.init({
      dsn: "https://public@o0.ingest.sentry.io/0",
      integrations: (defaults) => defaults.filter((integration) => integration.name === "Dedupe"),
      beforeSend(event) {
        events.push(event);
        return null;
      },
    });
  });

  afterEach(async () => {
    await Sentry.close();
    vi.restoreAllMocks();
  });

  it("sends one report, tagged with the feature", async () => {
    render(
      <FeatureErrorBoundaryWrapper featureName="Analytics">
        <Boom />
      </FeatureErrorBoundaryWrapper>,
      { onCaughtError: rootErrorHandlers.onCaughtError },
    );
    expect(screen.getByText("Analytics couldn't load")).toBeInTheDocument();

    await Sentry.flush();

    expect(events).toHaveLength(1);
    expect(events[0]?.tags).toMatchObject({ feature: "Analytics" });
  });

  it("still reports, from the root, an error caught by a boundary that is not Sentry's", async () => {
    render(
      <PlainBoundary>
        <Boom />
      </PlainBoundary>,
      { onCaughtError: rootErrorHandlers.onCaughtError },
    );
    expect(screen.getByText("plain fallback")).toBeInTheDocument();

    await Sentry.flush();

    expect(events).toHaveLength(1);
    expect(events[0]?.tags?.feature).toBeUndefined();
  });
});
