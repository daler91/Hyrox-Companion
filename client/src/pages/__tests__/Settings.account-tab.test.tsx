import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultSettings, renderSettings, seedSettings } from "./settingsTestHarness";

describe("Settings account tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.history.replaceState(null, "", "/settings");
  });

  // The other tabs' sections are lazy chunks behind their own Suspense. The
  // Account tab has none, so a lazy section there suspends the whole page to
  // the route-level spinner until its chunk arrives. Everything it renders
  // must ship with the page: `getBy`, not `findBy`, so a lazy one fails here.
  it("paints its units card on the first render, with no chunk to wait for", () => {
    const qc = new QueryClient();
    seedSettings(qc, defaultSettings());
    renderSettings(qc);

    expect(screen.getByTestId("tab-account")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("select-weight-unit")).toBeInTheDocument();
    expect(screen.getByTestId("select-distance-unit")).toBeInTheDocument();
  });
});
