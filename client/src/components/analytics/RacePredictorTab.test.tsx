import "@testing-library/jest-dom/vitest";

import type { RacePredictionResponse, RaceReadiness } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RacePredictorTab } from "./RacePredictorTab";

const mockUseRacePrediction = vi.fn();
vi.mock("./useRacePrediction", () => ({
  useRacePrediction: () => mockUseRacePrediction(),
}));

type RacePredictionView = RacePredictionResponse & { stale?: boolean };

function baseData(overrides: Partial<RacePredictionView> = {}): RacePredictionView {
  return {
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
    generatedAt: "2026-06-20T00:00:00Z",
    stale: false,
    ...overrides,
  };
}

function renderWith(data: RacePredictionView) {
  mockUseRacePrediction.mockReturnValue({
    query: { data, isLoading: false },
    refresh: vi.fn(),
    isRefreshing: false,
  });
  return render(<RacePredictorTab />);
}

describe("RacePredictorTab — race readiness", () => {
  it("renders the readiness card with status, Form (TSB), and taper guidance", () => {
    const raceReadiness: RaceReadiness = {
      tsb: -30,
      status: "very_fatigued",
      guidance: "High fatigue load. Prioritise recovery and a deliberate taper before racing.",
    };
    renderWith(baseData({ raceReadiness }));

    expect(screen.getByTestId("race-readiness-card")).toBeInTheDocument();
    expect(screen.getByTestId("race-readiness-status")).toHaveTextContent("Very fatigued");
    expect(screen.getByTestId("race-readiness-tsb")).toHaveTextContent("Form -30");
    expect(screen.getByTestId("race-readiness-guidance")).toHaveTextContent(/deliberate taper/);
  });

  it("shows a positive signed Form value for a fresh athlete", () => {
    renderWith(
      baseData({ raceReadiness: { tsb: 12, status: "fresh", guidance: "Good race form." } }),
    );
    expect(screen.getByTestId("race-readiness-tsb")).toHaveTextContent("Form +12");
  });

  it("omits the readiness card for older predictions without readiness data", () => {
    renderWith(baseData({ raceReadiness: undefined }));
    expect(screen.queryByTestId("race-readiness-card")).not.toBeInTheDocument();
  });
});
