import type { SessionGradeRollupCounts, SessionGradesResponse, SessionGradeWeek } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockSessionGrade } from "../../../../../test/factories";
import { toGradeChartRow } from "../session-grades/gradeChartData";
import { SessionGradesTab } from "../SessionGradesTab";

const mocks = vi.hoisted(() => ({ getSessionGrades: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, analytics: { ...actual.api.analytics, getSessionGrades: mocks.getSessionGrades } },
  };
});

function counts(overrides: Partial<SessionGradeRollupCounts> = {}): SessionGradeRollupCounts {
  const verdicts = { onTarget: 0, creptUp: 0, tooHard: 0, driftedHarder: 0, under: 0, inconclusive: 0, ungradeable: 0 };
  return {
    easy: { ...verdicts },
    threshold: { ...verdicts },
    graded: 0,
    onTarget: 0,
    onTargetRate: null,
    driftedHarder: 0,
    easyTooHard: 0,
    ungradeable: 0,
    pending: 0,
    plannedGradeable: 0,
    ...overrides,
  };
}

const LOADED: SessionGradesResponse = {
  plan: { id: "p1", name: "Autumn block", totalWeeks: 2, startDate: "2026-09-14", currentWeek: 2 },
  sessions: [
    createMockSessionGrade({ workoutLogId: "a", title: "Easy Run" }),
    createMockSessionGrade({
      workoutLogId: "b",
      title: "Threshold Run",
      intent: "threshold",
      purpose: "threshold",
      verdict: "drifted_harder",
      headline: "Drifted harder than threshold",
      evidence: ["HR climbed into Z5."],
    }),
  ],
  weeks: [
    {
      weekNumber: 1,
      weekStart: "2026-09-14",
      block: 1,
      phase: "early",
      deload: false,
      counts: counts({ easy: { onTarget: 3, creptUp: 1, tooHard: 0, driftedHarder: 0, under: 0, inconclusive: 0, ungradeable: 0 } }),
    },
    { weekNumber: 2, weekStart: "2026-09-21", block: 1, phase: "race_week", deload: false, counts: counts() },
  ],
  blocks: [
    {
      block: 1,
      firstWeek: 1,
      lastWeek: 2,
      phases: ["early", "race_week"],
      includesDeload: false,
      counts: counts({
        easy: { onTarget: 3, creptUp: 1, tooHard: 0, driftedHarder: 0, under: 0, inconclusive: 0, ungradeable: 0 },
        threshold: { onTarget: 1, creptUp: 0, tooHard: 0, driftedHarder: 1, under: 0, inconclusive: 0, ungradeable: 0 },
        driftedHarder: 1,
        easyTooHard: 1,
      }),
    },
  ],
  totals: counts({
    easy: { onTarget: 3, creptUp: 1, tooHard: 0, driftedHarder: 0, under: 0, inconclusive: 0, ungradeable: 0 },
    threshold: { onTarget: 1, creptUp: 0, tooHard: 0, driftedHarder: 1, under: 0, inconclusive: 0, ungradeable: 0 },
    driftedHarder: 1,
    easyTooHard: 1,
  }),
};

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["/api/v1/plans"], []);
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionGradesTab />
    </QueryClientProvider>,
  );
}

describe("SessionGradesTab", () => {
  beforeEach(() => {
    mocks.getSessionGrades.mockReset();
  });

  it("shows the plan's rates, the weekly chart, the block table and the recent runs", async () => {
    mocks.getSessionGrades.mockResolvedValue(LOADED);
    renderTab();

    await waitFor(() => expect(screen.getByTestId("text-session-grades-easy-rate")).toHaveTextContent("75%"));
    expect(mocks.getSessionGrades).toHaveBeenCalledWith(undefined);
    expect(screen.getByTestId("text-session-grades-threshold-rate")).toHaveTextContent("50%");
    expect(screen.getByTestId("text-session-grades-drifted")).toHaveTextContent("1");
    expect(
      screen.getByRole("img", { name: /Stacked bar chart of graded runs across 2 plan weeks: 3 of 4 did their job/ }),
    ).toBeInTheDocument();
    const row = screen.getByTestId("row-session-grades-block-1");
    expect(within(row).getByText("3 of 4 (75%)")).toBeInTheDocument();
    expect(within(row).getByText("Early, Race week")).toBeInTheDocument();
    expect(screen.getByTestId("link-session-grade-b")).toHaveAttribute("href", "/?workout=b");
    expect(screen.getByText("HR climbed into Z5.")).toBeInTheDocument();
  });

  it("explains what grading needs when there is no plan", async () => {
    mocks.getSessionGrades.mockResolvedValue({ plan: null, sessions: [], weeks: [], blocks: [], totals: null });
    renderTab();
    await waitFor(() => expect(screen.getByTestId("session-grades-empty")).toHaveTextContent(/Start a training plan/));
  });

  it("says nothing is graded yet on a plan with no graded runs", async () => {
    mocks.getSessionGrades.mockResolvedValue({ ...LOADED, sessions: [] });
    renderTab();
    await waitFor(() => expect(screen.getByTestId("session-grades-empty")).toHaveTextContent(/No graded runs in Autumn block/));
  });
});

describe("toGradeChartRow", () => {
  it("stacks verdicts into did its job / drifted a little / missed / can't tell", () => {
    const week: SessionGradeWeek = {
      weekNumber: 4,
      weekStart: null,
      block: 1,
      phase: "build",
      deload: true,
      counts: counts({
        easy: { onTarget: 2, creptUp: 1, tooHard: 1, driftedHarder: 0, under: 0, inconclusive: 0, ungradeable: 1 },
        threshold: { onTarget: 1, creptUp: 0, tooHard: 0, driftedHarder: 2, under: 1, inconclusive: 1, ungradeable: 0 },
      }),
    };
    expect(toGradeChartRow(week)).toMatchObject({
      week: "W4",
      deload: true,
      onTarget: 3,
      partial: 2,
      missed: 3,
      unclear: 2,
    });
  });
});
