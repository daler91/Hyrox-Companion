import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChunkLoadError } from "@/lib/lazyWithReload";

import { FallbackErrorBoundary } from "../FallbackErrorBoundary";
import { FeatureErrorBoundary } from "../FeatureErrorBoundary";

const reload = vi.fn();
const resetError = vi.fn();
const originalLocation = globalThis.location;

const chunkError = new ChunkLoadError(
  new TypeError("Failed to fetch dynamically imported module: https://app.example/assets/Analytics-0ld.js"),
);
const renderError = new TypeError("Cannot read properties of undefined (reading 'map')");

// React keeps a rejected lazy import, so resetting the boundary over a chunk
// error only re-throws it: "Try again" has to reload (CL3, CODEBASE_ANALYSIS_2026-10-03).
describe("error boundary Try again (CL3)", () => {
  beforeEach(() => {
    reload.mockReset();
    resetError.mockReset();
    Object.defineProperty(globalThis, "location", { configurable: true, value: { reload } });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
  });

  it("reloads the page for a failed route chunk in a feature boundary", () => {
    render(<FeatureErrorBoundary error={chunkError} resetError={resetError} featureName="Analytics" />);
    expect(screen.getByText("Tap Try again to reload the page.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-feature-retry"));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(resetError).not.toHaveBeenCalled();
  });

  it("resets a feature boundary for an ordinary render error", () => {
    render(<FeatureErrorBoundary error={renderError} resetError={resetError} featureName="Analytics" />);
    expect(screen.getByText("Tap Try again to reload this section.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-feature-retry"));
    expect(resetError).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the page for a failed chunk in the root boundary", () => {
    render(<FallbackErrorBoundary error={chunkError} resetError={resetError} />);
    fireEvent.click(screen.getByTestId("button-retry"));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(resetError).not.toHaveBeenCalled();
  });

  it("resets the root boundary for an ordinary render error, and Refresh still reloads", () => {
    render(<FallbackErrorBoundary error={renderError} resetError={resetError} />);
    fireEvent.click(screen.getByTestId("button-retry"));
    expect(resetError).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("button-refresh"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
