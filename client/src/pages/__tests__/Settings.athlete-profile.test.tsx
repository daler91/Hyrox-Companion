import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chooseSelectOption,
  defaultSettings,
  makeSettingsDirty,
  renderSettings,
  seedSettings,
  settingsHarness,
} from "./settingsTestHarness";

describe("Settings race profile persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalThis.history.replaceState(null, "", "/settings");
    vi.mocked(settingsHarness.updatePreferences).mockResolvedValue({});
  });

  // Regression: the Save payload previously omitted `gender`, so a change to
  // the race-profile gender select looked saved (toast + cleared save bar) but
  // never reached the PATCH body. Because the server does a partial update,
  // the value silently reverted to its stored default on the next refetch.
  it("sends the changed gender in the save payload", async () => {
    const qc = new QueryClient();
    seedSettings(qc, defaultSettings());
    renderSettings(qc);

    await chooseSelectOption("Select gender", "Men");

    fireEvent.click(await screen.findByTestId("button-save-settings"));

    await waitFor(() => {
      expect(settingsHarness.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ gender: "male" }),
      );
    });
  }, 10_000);

  // Sibling field on the same payload line — guard it against the same drop.
  it("sends the changed division in the save payload", async () => {
    const qc = new QueryClient();
    seedSettings(qc, defaultSettings());
    renderSettings(qc);

    await chooseSelectOption("Select division", "Pro");

    fireEvent.click(await screen.findByTestId("button-save-settings"));

    await waitFor(() => {
      expect(settingsHarness.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ division: "pro" }),
      );
    });
  }, 10_000);

  // The payload always carries the full preference set: an unrelated edit must
  // still forward the seeded gender/division rather than dropping them.
  it("preserves gender and division when an unrelated field changes", async () => {
    const qc = new QueryClient();
    seedSettings(qc, { ...defaultSettings(), gender: "female", division: "pro" });
    renderSettings(qc);

    await makeSettingsDirty();

    fireEvent.click(await screen.findByTestId("button-save-settings"));

    await waitFor(() => {
      expect(settingsHarness.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ gender: "female", division: "pro", weeklyGoal: 6 }),
      );
    });
  }, 10_000);
});
