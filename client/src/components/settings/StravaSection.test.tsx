import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StravaStatus } from "@/lib/api";

import { describeStravaStatus, StravaSection } from "./StravaSection";

const mutations = vi.hoisted(() => {
  const idle = { mutate: vi.fn(), isPending: false };
  return { connectStravaMutation: idle, disconnectStravaMutation: idle, syncStravaMutation: idle };
});

vi.mock("@/hooks/useStravaMutations", () => ({
  useStravaMutations: () => mutations,
}));

const connected: StravaStatus = {
  connected: true,
  athleteId: "12345",
  lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  autoSync: { enabled: true, webhook: true, intervalMinutes: 60 },
};

function renderSection(stravaStatus: StravaStatus | undefined) {
  return render(<StravaSection stravaStatus={stravaStatus} stravaLoading={false} />);
}

describe("StravaSection automatic sync copy", () => {
  it("explains push-based sync once the webhook subscription is verified", () => {
    renderSection(connected);

    expect(screen.getByTestId("text-strava-status")).toHaveTextContent(/^Last synced/);
    expect(screen.getByTestId("text-strava-auto-sync")).toHaveTextContent(
      "usually within a minute of finishing",
    );
    expect(screen.getByTestId("button-sync-strava")).toHaveTextContent("Sync now");
  });

  it("names the polling cadence when there is no push subscription", () => {
    renderSection({
      ...connected,
      autoSync: { enabled: true, webhook: false, intervalMinutes: 60 },
    });

    expect(screen.getByTestId("text-strava-auto-sync")).toHaveTextContent("checked every hour");
  });

  it("shows the first import as in progress right after connecting", () => {
    renderSection({ ...connected, lastSyncedAt: null });

    expect(screen.getByTestId("text-strava-status")).toHaveTextContent(
      "Importing your recent activities",
    );
  });

  it("reads as before when the server predates automatic sync or has it switched off", () => {
    renderSection({ connected: true, athleteId: "12345", lastSyncedAt: null });

    expect(screen.getByTestId("text-strava-status")).toHaveTextContent("Not yet synced");
    expect(screen.queryByTestId("text-strava-auto-sync")).not.toBeInTheDocument();
  });

  it("sets the expectation before the athlete connects", () => {
    renderSection({
      connected: false,
      autoSync: { enabled: true, webhook: true, intervalMinutes: 60 },
    });

    expect(screen.getByTestId("button-connect-strava")).toBeInTheDocument();
    expect(screen.getByTestId("text-strava-auto-sync")).toHaveTextContent("Connect once");
  });

  it("keeps the reconnect message when Strava revoked access", () => {
    renderSection({ ...connected, requiresReauth: true });

    expect(screen.getByTestId("text-strava-status")).toHaveTextContent(
      "Reconnect to resume syncing",
    );
    expect(screen.queryByTestId("text-strava-auto-sync")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-reconnect-strava")).toBeInTheDocument();
  });

  it("formats the polling interval in whole hours or minutes", () => {
    const polling = (intervalMinutes: number) =>
      describeStravaStatus(
        {
          connected: true,
          lastSyncedAt: null,
          autoSync: { enabled: true, webhook: false, intervalMinutes },
        },
        false,
      ).hint;

    expect(polling(120)).toContain("every 2 hours");
    expect(polling(30)).toContain("every 30 minutes");
    expect(polling(60)).toContain("every hour");
  });
});
