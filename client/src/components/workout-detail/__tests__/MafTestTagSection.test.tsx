import type { WorkoutLog } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MafTestTagSection } from "../MafTestTagSection";

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  tagWorkout: vi.fn(),
  updateTest: vi.fn(),
  untagWorkout: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { mafTests: apiMocks },
  QUERY_KEYS: { mafTests: ["/api/v1/maf-tests"], preferences: ["/api/v1/preferences"] },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", trainingStyleId: "maf_method", mafHr: 140 } }),
}));
vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ distanceUnit: "km", distanceLabel: "km" }),
}));
vi.mock("@/hooks/use-toast", async () => (await import("@/test/support/mutationHookMocks")).makeToastMock());

function renderSection(workout: Partial<WorkoutLog>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MafTestTagSection workoutLogId="log-1" workout={{ id: "log-1", ...workout } as WorkoutLog} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.list.mockResolvedValue({ tests: [], analysis: [] });
  apiMocks.tagWorkout.mockResolvedValue({});
});

describe("MafTestTagSection", () => {
  // CL2 (CODEBASE_ANALYSIS_2026-10-03): workout_logs.duration is minutes, the
  // form is seconds. Seeding the raw minutes showed "0:45" and stored a pace
  // 60x too fast when the athlete accepted the prefill.
  it("prefills a 45-minute run as 45:00 and submits it as 2700 seconds", async () => {
    const user = userEvent.setup();
    renderSection({ duration: 45, distanceMeters: 8000, avgHeartrate: 138, maxHeartrate: 146 });

    await user.click(await screen.findByTestId("maf-test-tag-button-log-1"));

    expect(screen.getByTestId("maf-test-form-log-1-duration")).toHaveValue("45:00");

    await user.click(screen.getByTestId("maf-test-form-log-1-submit"));

    await waitFor(() =>
      expect(apiMocks.tagWorkout).toHaveBeenCalledWith("log-1", {
        metrics: { avgHeartRate: 138, maxHeartRate: 146, durationSeconds: 2700, distanceMeters: 8000 },
      }),
    );
  });

  it("leaves the duration blank when the workout has none", async () => {
    const user = userEvent.setup();
    renderSection({ duration: null, distanceMeters: 8000, avgHeartrate: 138, maxHeartrate: null });

    await user.click(await screen.findByTestId("maf-test-tag-button-log-1"));

    expect(screen.getByTestId("maf-test-form-log-1-duration")).toHaveValue("");
  });
});
