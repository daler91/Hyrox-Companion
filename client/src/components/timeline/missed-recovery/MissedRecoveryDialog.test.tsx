import type { MissedSessionRecoveryPreview, RecoveryTarget, TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MissedRecoveryDialog } from "./MissedRecoveryDialog";

const apiMocks = vi.hoisted(() => ({
  getMissedRecovery: vi.fn(),
  applyMissedRecovery: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { plans: apiMocks },
  QUERY_KEYS: {
    timeline: ["/api/v1/timeline"],
    trainingOverview: ["/api/v1/training-overview"],
    plans: ["/api/v1/plans"],
    missedRecovery: (dayId: string) => ["/api/v1/plans/days", dayId, "recovery"],
  },
}));
vi.mock("@/hooks/use-toast", async () => (await import("@/test/support/mutationHookMocks")).makeToastMock());

const entry = {
  id: "plan-pd-1",
  date: "2026-09-22",
  type: "planned",
  status: "missed",
  focus: "Threshold run",
  mainWorkout: "5 x 1 km",
  accessory: null,
  notes: null,
  planDayId: "pd-1",
  priority: "key",
} as TimelineEntry;

function target(date: string, overrides: Partial<RecoveryTarget["impact"]> = {}, sessions: RecoveryTarget["sessions"] = []): RecoveryTarget {
  return {
    date,
    sessions,
    impact: {
      summary: `Moves to ${date}.`,
      keptFraction: 1,
      keptMinutes: 50,
      day: { date, minutesAfter: 50 },
      weeks: [
        {
          weekStart: "2026-09-21",
          minutesBefore: 200,
          minutesAfter: 200,
          loadBefore: 300,
          loadAfter: 300,
          keyBefore: 2,
          keyAfter: 2,
          keyScheduled: 2,
        },
      ],
      notes: [],
      ...overrides,
    },
  };
}

const preview: MissedSessionRecoveryPreview = {
  planDayId: "pd-1",
  missedDate: "2026-09-22",
  focus: "Threshold run",
  priority: "key",
  recovery: null,
  today: "2026-09-24",
  session: { durationMin: 50, estimated: false, rpe: 7, hard: true },
  recommendation: {
    action: "fold",
    targetDate: "2026-09-24",
    reason: "A key session, and today has room for all of it.",
  },
  fold: {
    available: true,
    unavailableReason: null,
    suggestedDate: "2026-09-24",
    targets: [
      target("2026-09-24"),
      target(
        "2026-09-25",
        {
          summary: "Tomorrow gets the full Threshold run alongside Intervals.",
          notes: [{ code: "stacked_key", tone: "warning", message: "Tomorrow already has a key session." }],
        },
        [{ focus: "Intervals", priority: "key", durationMin: 50, status: "planned" }],
      ),
    ],
  },
  shorten: {
    available: true,
    unavailableReason: null,
    suggestedDate: "2026-09-24",
    targets: [
      target("2026-09-24", { summary: "Today gets a 30 min version.", keptFraction: 0.6, keptMinutes: 30 }),
      target("2026-09-25", { keptFraction: 0.6, keptMinutes: 30 }),
    ],
    durationMin: 30,
    keptFraction: 0.6,
    changes: [{ label: "Intervals", from: "5 sets", to: "3 sets" }],
  },
  letGo: {
    impact: {
      summary: "Threshold run stays missed, and the rest of the plan carries on as it is.",
      keptFraction: 0,
      keptMinutes: 0,
      day: null,
      weeks: [
        {
          weekStart: "2026-09-21",
          minutesBefore: 200,
          minutesAfter: 150,
          loadBefore: 300,
          loadAfter: 228,
          keyBefore: 2,
          keyAfter: 1,
          keyScheduled: 2,
        },
      ],
      notes: [],
    },
  },
};

function renderDialog(option: "fold" | "shorten" | "let_go" | null = null) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MissedRecoveryDialog request={{ entry, option }} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...view, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getMissedRecovery.mockResolvedValue(preview);
  apiMocks.applyMissedRecovery.mockResolvedValue({ day: { id: "pd-1" } });
});

describe("MissedRecoveryDialog", () => {
  it("opens on the recommendation and shows what it does to the plan", async () => {
    renderDialog();

    expect(await screen.findByTestId("missed-recovery-recommendation")).toHaveTextContent(
      "A key session, and today has room for all of it.",
    );
    expect(screen.getByRole("radio", { name: /fold it into another day/i })).toBeChecked();
    expect(screen.getByTestId("missed-recovery-option-fold-recommended")).toBeInTheDocument();
    expect(screen.getByTestId("missed-recovery-day-2026-09-24")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("missed-recovery-impact")).toHaveTextContent("Moves to 2026-09-24.");
    expect(screen.getByTestId("missed-recovery-kept")).toHaveTextContent("Keeps all of it (50 min)");
    expect(screen.getByTestId("missed-recovery-week-2026-09-21")).toHaveTextContent("This week");
    expect(screen.getByTestId("missed-recovery-confirm")).toHaveTextContent("Fold into today");
    expect(apiMocks.getMissedRecovery).toHaveBeenCalledWith("pd-1");
  });

  it("shows another day's cautions when the athlete picks it, and folds into it", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(await screen.findByTestId("missed-recovery-day-2026-09-25"));

    expect(screen.getByTestId("missed-recovery-notes")).toHaveTextContent("Tomorrow already has a key session.");
    expect(screen.getByTestId("missed-recovery-day-2026-09-25")).toHaveTextContent("Intervals");
    await user.click(screen.getByTestId("missed-recovery-confirm"));

    await waitFor(() =>
      expect(apiMocks.applyMissedRecovery).toHaveBeenCalledWith("pd-1", { action: "fold", targetDate: "2026-09-25" }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("opens on the option tapped on the card, with the cut spelled out", async () => {
    const user = userEvent.setup();
    renderDialog("shorten");

    expect(await screen.findByRole("radio", { name: /shorten it/i })).toBeChecked();
    expect(screen.getByTestId("missed-recovery-shorten-changes")).toHaveTextContent("Intervals: 5 sets → 3 sets");
    expect(screen.getByTestId("missed-recovery-kept")).toHaveTextContent("Keeps about 60% (30 min of 50 min)");

    await user.click(screen.getByTestId("missed-recovery-confirm"));
    await waitFor(() =>
      expect(apiMocks.applyMissedRecovery).toHaveBeenCalledWith("pd-1", {
        action: "shorten",
        targetDate: "2026-09-24",
      }),
    );
  });

  it("shows what letting it go costs the week before doing it", async () => {
    const user = userEvent.setup();
    renderDialog("let_go");

    expect(await screen.findByTestId("missed-recovery-impact")).toHaveTextContent(
      "Threshold run stays missed, and the rest of the plan carries on as it is.",
    );
    expect(screen.getByTestId("missed-recovery-week-2026-09-21")).toHaveTextContent("3h 20m → 2h 30m · load −24%");
    expect(screen.getByTestId("missed-recovery-key-sessions")).toHaveTextContent("2 → 1 of 2");
    expect(screen.queryByText("Which day?")).toBeNull();

    await user.click(screen.getByTestId("missed-recovery-confirm"));
    await waitFor(() => expect(apiMocks.applyMissedRecovery).toHaveBeenCalledWith("pd-1", { action: "let_go" }));
  });

  it("explains an option that is not available", async () => {
    apiMocks.getMissedRecovery.mockResolvedValue({
      ...preview,
      recommendation: { action: "let_go", targetDate: null, reason: "It was missed more than a week ago." },
      fold: { available: false, unavailableReason: "It was missed more than a week ago — the plan has moved on.", suggestedDate: null, targets: [] },
      shorten: { ...preview.shorten, available: false, unavailableReason: "It was missed more than a week ago — the plan has moved on.", suggestedDate: null, targets: [] },
    });
    renderDialog("fold");

    // The tapped option is unavailable, so the sheet opens on the recommendation.
    expect(await screen.findByRole("radio", { name: /let it go/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /fold it into another day/i })).toBeDisabled();
    expect(screen.getByTestId("missed-recovery-option-fold-card")).toHaveTextContent("the plan has moved on");
  });

  it("offers a retry when the preview can't load", async () => {
    apiMocks.getMissedRecovery.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByTestId("missed-recovery-error")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("missed-recovery-chooser")).toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { baseElement } = renderDialog();
    await screen.findByTestId("missed-recovery-chooser");
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
