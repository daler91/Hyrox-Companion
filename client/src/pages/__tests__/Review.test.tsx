import type { WeeklyReview } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Review from "../Review";

const mocks = vi.hoisted(() => ({
  getWeeklyReview: vi.fn(),
  setWeek: vi.fn(),
  week: "2026-06-08",
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, analytics: { ...actual.api.analytics, getWeeklyReview: mocks.getWeeklyReview } },
  };
});

vi.mock("@/hooks/useUrlQueryState", () => ({
  useUrlQueryState: () => [mocks.week, mocks.setWeek],
}));

function review(overrides: Partial<WeeklyReview> = {}): WeeklyReview {
  return {
    weekStart: "2026-06-08",
    weekEnd: "2026-06-14",
    timezone: "UTC",
    isCurrentWeek: false,
    weeklyGoal: 4,
    hasPlan: true,
    current: {
      sessionsLogged: 3, sessionsPlanned: 4, plannedCompleted: 3,
      missed: 1, skipped: 0, outstanding: 0, totalDurationMin: 180, avgRpe: 7,
    },
    previous: {
      sessionsLogged: 2, sessionsPlanned: 4, plannedCompleted: 2,
      missed: 2, skipped: 0, outstanding: 0, totalDurationMin: 120, avgRpe: 6,
    },
    deltas: { sessionsLogged: 1, totalDurationMin: 60, avgRpe: 1 },
    sessions: [],
    plannedDays: [],
    personalRecords: [],
    annotations: [],
    ...overrides,
  };
}

function session(overrides: Partial<WeeklyReview["sessions"][number]> = {}) {
  return {
    workoutLogId: "wl-1",
    date: "2026-06-09",
    focus: "Threshold Intervals",
    durationMin: 60,
    rpe: 7,
    source: "manual",
    planDayId: "pd-1",
    compliancePct: 92,
    matchedSetCount: 11,
    addedSetCount: 0,
    removedSetCount: 0,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Review />
    </QueryClientProvider>,
  );
}

describe("Review page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.week = "2026-06-08";
    mocks.getWeeklyReview.mockResolvedValue(review());
  });

  it("shows the week it renders, not the week that was requested", async () => {
    // The server resolves the week in the athlete's stored timezone, which can
    // differ from the browser's by a day.
    mocks.getWeeklyReview.mockResolvedValue(review({ weekStart: "2026-06-01", weekEnd: "2026-06-07" }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("weekly-review-range")).toHaveTextContent("Jun 1–7, 2026");
    });
  });

  it("reports sessions and plan adherence as two numbers", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review-sessions")).toBeInTheDocument());
    expect(screen.getByTestId("weekly-review-sessions")).toHaveTextContent("3");
    expect(screen.getByTestId("weekly-review-adherence")).toHaveTextContent("3/4");
  });

  it("never implies over-100% adherence when the athlete trains off plan", async () => {
    // Four logged, one planned: as a single rate this would read 400%.
    mocks.getWeeklyReview.mockResolvedValue(
      review({
        current: {
          sessionsLogged: 4, sessionsPlanned: 1, plannedCompleted: 1,
          missed: 0, skipped: 0, outstanding: 0, totalDurationMin: 240, avgRpe: 6,
        },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review-adherence")).toBeInTheDocument());
    expect(screen.getByTestId("weekly-review-sessions")).toHaveTextContent("4");
    expect(screen.getByTestId("weekly-review-adherence")).toHaveTextContent("1/1");
  });

  it("hides the adherence tile for an athlete with no plan", async () => {
    mocks.getWeeklyReview.mockResolvedValue(
      review({
        hasPlan: false,
        current: {
          sessionsLogged: 2, sessionsPlanned: 0, plannedCompleted: 0,
          missed: 0, skipped: 0, outstanding: 0, totalDurationMin: 90, avgRpe: 6,
        },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review-sessions")).toBeInTheDocument());
    // "0 of 0" would be a verdict on a plan they never had.
    expect(screen.queryByTestId("weekly-review-adherence")).not.toBeInTheDocument();
  });

  it("leads with context when the week sits inside an injury", async () => {
    mocks.getWeeklyReview.mockResolvedValue(
      review({
        annotations: [
          { id: "a1", type: "injury", startDate: "2026-05-25", endDate: "2026-06-20", note: "Achilles" },
        ],
        plannedDays: [
          { planDayId: "pd-9", date: "2026-06-10", focus: "Long Run", status: "missed", skipReason: null, planName: "Plan" },
        ],
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review-annotations")).toBeInTheDocument());
    expect(screen.getByTestId("weekly-review-annotations")).toHaveTextContent("Achilles");
    expect(screen.getByText(/aren't a shortfall/i)).toBeInTheDocument();
  });

  it("names the skip reason next to what did not happen", async () => {
    mocks.getWeeklyReview.mockResolvedValue(
      review({
        plannedDays: [
          { planDayId: "pd-2", date: "2026-06-11", focus: "Sled Push", status: "skipped", skipReason: "injured", planName: "Plan" },
        ],
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review-planned-pd-2")).toBeInTheDocument());
    expect(screen.getByTestId("weekly-review-skip-reason-pd-2")).toHaveTextContent("Injured");
  });

  it("shows what the athlete added and dropped, not just the compliance number", async () => {
    mocks.getWeeklyReview.mockResolvedValue(
      review({ sessions: [session({ addedSetCount: 2, removedSetCount: 1, compliancePct: 71 })] }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review-session-wl-1")).toBeInTheDocument());
    expect(screen.getByTestId("weekly-review-session-changes-wl-1")).toHaveTextContent("+2 / −1 sets");
  });

  it("reads as a starting point, not a report card, on an empty week", async () => {
    mocks.getWeeklyReview.mockResolvedValue(
      review({
        hasPlan: false,
        current: {
          sessionsLogged: 0, sessionsPlanned: 0, plannedCompleted: 0,
          missed: 0, skipped: 0, outstanding: 0, totalDurationMin: 0, avgRpe: null,
        },
        previous: {
          sessionsLogged: 0, sessionsPlanned: 0, plannedCompleted: 0,
          missed: 0, skipped: 0, outstanding: 0, totalDurationMin: 0, avgRpe: null,
        },
        deltas: { sessionsLogged: 0, totalDurationMin: 0, avgRpe: null },
      }),
    );
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("weekly-review-adherence")).not.toBeInTheDocument();
    expect(screen.getByTestId("weekly-review-rpe")).toHaveTextContent("—");
  });

  it("frames the in-progress week as unfinished", async () => {
    mocks.getWeeklyReview.mockResolvedValue(review({ isCurrentWeek: true }));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review-in-progress")).toBeInTheDocument());
    expect(screen.getByTestId("weekly-review-sessions")).toHaveTextContent("Sessions so far");
    // Nothing to review in a week that has not started.
    expect(screen.getByTestId("weekly-review-next")).toBeDisabled();
  });

  it("pages back a week from the week the server resolved", async () => {
    const user = userEvent.setup();
    mocks.getWeeklyReview.mockResolvedValue(review({ weekStart: "2026-06-01", weekEnd: "2026-06-07" }));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review")).toBeInTheDocument());
    await user.click(screen.getByTestId("weekly-review-prev"));

    // Stepping from the requested "2026-06-08" would have skipped a week.
    expect(mocks.setWeek).toHaveBeenCalledWith("2026-05-25");
  });

  it("offers a retry when the week fails to load", async () => {
    mocks.getWeeklyReview.mockRejectedValue(new Error("boom"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("weekly-review-error")).toBeInTheDocument());
    expect(screen.getByTestId("weekly-review-retry")).toBeInTheDocument();
  });
});
