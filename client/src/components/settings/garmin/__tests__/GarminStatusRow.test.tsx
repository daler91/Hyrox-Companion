import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GarminStatusRow } from "../GarminStatusRow";

function renderRow(syncPausedText: string | null) {
  render(
    <GarminStatusRow
      isConnected
      hasError={false}
      statusText="Last synced 2 hours ago"
      syncPausedText={syncPausedText}
      isSyncing={false}
      isDisconnecting={false}
      onSync={vi.fn()}
      onDisconnect={vi.fn()}
    />,
  );
}

// Tech debt #55: Sync stayed enabled while Garmin calls were paused.
describe("GarminStatusRow while sync is paused", () => {
  it("disables Sync and says why", () => {
    renderRow("Garmin paused syncing after a rate limit. Try again after 12:20 PM.");

    const sync = screen.getByTestId("button-sync-garmin");
    expect(sync).toBeDisabled();
    expect(sync).toHaveAccessibleDescription("Garmin paused syncing after a rate limit. Try again after 12:20 PM.");
  });

  it("leaves Sync enabled with no pause", () => {
    renderRow(null);

    expect(screen.getByTestId("button-sync-garmin")).toBeEnabled();
    expect(screen.queryByTestId("text-garmin-sync-paused")).not.toBeInTheDocument();
  });
});
