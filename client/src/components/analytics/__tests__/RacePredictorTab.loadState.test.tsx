import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RacePredictionView } from "@/lib/api";

import { RacePredictorTab } from "../RacePredictorTab";

const getRacePrediction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, analytics: { ...actual.api.analytics, getRacePrediction } },
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

const PREDICTION: RacePredictionView = {
  totalFinishSeconds: 3600,
  segments: [],
  transitionSeconds: 0,
  aiUsed: true,
  aiUnavailableReason: null,
  overallConfidence: "medium",
  narrative: null,
  division: "open",
  gender: "male",
  genderAssumed: false,
  ageGroup: "30-34",
  ageGroupAssumed: false,
  percentile: null,
  dataCompleteness: { stationsWithData: 8, totalStations: 8, hasRunData: true },
  generatedAt: "2026-10-01T00:00:00Z",
  stale: false,
};

function renderTab(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <RacePredictorTab />
      </QueryClientProvider>,
    ),
  };
}

/** Whether Retry, a regeneration that may spend AI budget, was ever sent. */
function regenerated(): boolean {
  return getRacePrediction.mock.calls.some(([options]) => options !== undefined);
}

// U5 (CODEBASE_ANALYSIS_2026-10-03): TanStack pauses rather than runs a fetch
// while the browser is offline, so a first fetch is pending but not
// `isLoading`, and the tab said it couldn't load before anything had failed.
describe("RacePredictorTab load states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("shows loading, not an error, while the first fetch waits offline", async () => {
    getRacePrediction.mockResolvedValue(PREDICTION);
    onlineManager.setOnline(false);
    renderTab();

    expect(await screen.findByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByText(/Couldn't load your race prediction/)).not.toBeInTheDocument();
    expect(getRacePrediction).not.toHaveBeenCalled();

    act(() => {
      onlineManager.setOnline(true);
    });
    expect(await screen.findByTestId("race-prediction-total")).toHaveTextContent("1:00:00");
    expect(regenerated()).toBe(false);
  });

  it("says it couldn't load a failed fetch, and regenerates only on Retry", async () => {
    const user = userEvent.setup();
    getRacePrediction.mockRejectedValueOnce(new Error("500: Internal Server Error"));
    renderTab();

    const retry = await screen.findByTestId("race-prediction-retry");
    expect(screen.getByTestId("race-prediction-load-error")).toHaveTextContent(
      "Couldn't load your race prediction. Please try again.",
    );
    expect(regenerated()).toBe(false);

    getRacePrediction.mockResolvedValueOnce(PREDICTION);
    await user.click(retry);

    expect(await screen.findByTestId("race-prediction-total")).toBeInTheDocument();
    expect(getRacePrediction).toHaveBeenLastCalledWith({ refresh: true });
  });

  // Coming back to the tab retries the read by itself; Retry, which would
  // regenerate on top of it, waits for that read.
  it("marks Retry busy while the query's own retry runs, without regenerating", async () => {
    getRacePrediction.mockRejectedValueOnce(new Error("500: Internal Server Error"));
    const { client, unmount } = renderTab();
    await screen.findByTestId("race-prediction-retry");
    unmount();

    getRacePrediction.mockReturnValueOnce(
      new Promise(() => {
        // never settles
      }),
    );
    renderTab(client);

    await waitFor(() => {
      expect(screen.getByTestId("race-prediction-retry")).toBeDisabled();
    });
    expect(screen.getByTestId("race-prediction-retry")).toHaveTextContent("Retrying…");
    // It no longer asks for the retry already under way.
    expect(screen.getByTestId("race-prediction-load-error")).toHaveTextContent(
      /^Couldn't load your race prediction\.$/,
    );
    expect(getRacePrediction).toHaveBeenCalledTimes(2);
    expect(regenerated()).toBe(false);
  });

  it("stops asking to try again while the athlete's own Retry runs", async () => {
    const user = userEvent.setup();
    getRacePrediction.mockRejectedValueOnce(new Error("500: Internal Server Error"));
    renderTab();

    const retry = await screen.findByTestId("race-prediction-retry");
    getRacePrediction.mockReturnValueOnce(
      new Promise(() => {
        // never settles
      }),
    );
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getByTestId("race-prediction-retry")).toHaveTextContent("Retrying…");
    });
    expect(screen.getByTestId("race-prediction-load-error")).not.toHaveTextContent(
      "Please try again",
    );
  });
});
