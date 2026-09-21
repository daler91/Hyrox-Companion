import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultSettings,
  goToSettingsTab,
  renderSettings,
  seedSettings,
  settingsHarness,
} from "./settingsTestHarness";

describe("Settings recycle bin tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalThis.history.replaceState(null, "", "/settings");
    vi.mocked(settingsHarness.updatePreferences).mockResolvedValue({});
  });

  it("shows the recycle bin on its own tab, separate from Data & Privacy", async () => {
    const qc = new QueryClient();
    seedSettings(qc, defaultSettings());
    renderSettings(qc);

    await goToSettingsTab("data");
    expect(await screen.findByTestId("data-tools-section")).toBeInTheDocument();
    expect(screen.queryByTestId("recycle-bin-card")).not.toBeInTheDocument();

    await goToSettingsTab("recycle-bin");
    expect(await screen.findByTestId("recycle-bin-card")).toBeInTheDocument();
    expect(screen.queryByTestId("data-tools-section")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(globalThis.location.search).toBe("?tab=recycle-bin");
    });
  });

  it("deep-links to the recycle bin tab via ?tab=recycle-bin", async () => {
    globalThis.history.replaceState(null, "", "/settings?tab=recycle-bin");
    const qc = new QueryClient();
    seedSettings(qc, defaultSettings());
    renderSettings(qc);

    expect(await screen.findByTestId("recycle-bin-card")).toBeInTheDocument();
    expect(screen.getByTestId("tab-recycle-bin")).toHaveAttribute("data-state", "active");
  });
});
