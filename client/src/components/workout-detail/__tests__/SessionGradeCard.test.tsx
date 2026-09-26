import type { SessionGrade } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockSessionGrade } from "../../../../../test/factories";
import { SessionGradeCard } from "../SessionGradeCard";

const mocks = vi.hoisted(() => ({ getWorkoutSessionGrade: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      analytics: { ...actual.api.analytics, getWorkoutSessionGrade: mocks.getWorkoutSessionGrade },
    },
  };
});

const AXE_TIMEOUT_MS = 10_000;

function renderCard(grade: SessionGrade | null, workoutLogId: string | null = "w1") {
  mocks.getWorkoutSessionGrade.mockResolvedValue({ grade });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionGradeCard workoutLogId={workoutLogId} distanceUnit="km" />
    </QueryClientProvider>,
  );
}

const THRESHOLD_GRADE = createMockSessionGrade({
  workoutLogId: "w1",
  title: "Threshold Run",
  intent: "threshold",
  purpose: "threshold",
  verdict: "drifted_harder",
  headline: "Drifted harder than threshold",
  evidence: [
    "Found 3 reps, 30 min of work at 4:44/km vs 4:52/km threshold.",
    "HR climbed from 170 bpm on the first rep to 179 bpm on the last, into Z5.",
  ],
  threshold: {
    segmentation: "reps",
    workMinutes: 30,
    repCount: 3,
    workAvgPaceSecPerKm: 284,
    paceDeltaPct: -2.7,
    workAvgHr: 174,
    pctWorkZ4: 60,
    pctWorkZ5: 32,
    firstRepHr: 170,
    lastRepHr: 179,
    decouplingPct: 3,
  },
});

describe("SessionGradeCard", () => {
  beforeEach(() => {
    mocks.getWorkoutSessionGrade.mockReset();
  });

  it("shows the purpose, the verdict, the evidence and the key numbers", async () => {
    renderCard(THRESHOLD_GRADE);

    await waitFor(() => expect(screen.getByTestId("session-grade-card-w1")).toBeInTheDocument());
    expect(screen.getByText("Did it do its job?")).toBeInTheDocument();
    expect(screen.getByText("Threshold run")).toBeInTheDocument();
    expect(screen.getByTestId("session-grade-verdict")).toHaveTextContent("Drifted harder");
    expect(screen.getByText(/into Z5/)).toBeInTheDocument();
    expect(screen.getByText("4:44/km")).toBeInTheDocument();
    expect(screen.getByText("32%")).toBeInTheDocument();
    expect(screen.getByText(/From the heart-rate and pace stream · High confidence/)).toBeInTheDocument();
    expect(mocks.getWorkoutSessionGrade).toHaveBeenCalledWith("w1");
  });

  it("says when the grade is from averages while the stream is on its way", async () => {
    renderCard(createMockSessionGrade({ workoutLogId: "w1", dataSource: "summary", confidence: "low", streamStatus: "pending" }));
    await waitFor(() => expect(screen.getByText(/the detailed stream is on its way/)).toBeInTheDocument());
  });

  it("points to Settings when there is nothing to grade against", async () => {
    renderCard(
      createMockSessionGrade({
        workoutLogId: "w1",
        verdict: "ungradeable",
        headline: "Can't grade yet",
        ungradeableReason: "no_targets",
        confidence: null,
        dataSource: null,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Add your max heart rate in Settings" })).toHaveAttribute("href", "/settings"),
    );
  });

  it("renders nothing for a workout that is not graded", async () => {
    const { container } = renderCard(null);
    await waitFor(() => expect(mocks.getWorkoutSessionGrade).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it(
    "has no WCAG violations",
    async () => {
      const { container } = renderCard(THRESHOLD_GRADE);
      await waitFor(() => expect(screen.getByTestId("session-grade-card-w1")).toBeInTheDocument());
      expect(await axe(container)).toHaveNoViolations();
    },
    AXE_TIMEOUT_MS,
  );
});
