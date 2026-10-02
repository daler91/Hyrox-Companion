import type { EnrichedPlanAdjustmentChange, PlanAdjustmentProposal } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRecentlyAppliedMock } = vi.hoisted(() => ({ getRecentlyAppliedMock: vi.fn() }));
vi.mock("../storage", () => ({ storage: { planProposals: { getRecentlyApplied: getRecentlyAppliedMock } } }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));

import { formatRecentPlanChanges } from "../prompts/recentPlanChanges";
import { loadRecentPlanChanges } from "./recentPlanChanges";

const NOW = new Date("2026-10-02T10:10:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/** A change to a session that was on `from`, with `fields` its updated fields. */
function change(
  planDayId: string,
  focus: string,
  from: string | null,
  fields: EnrichedPlanAdjustmentChange["updatedFields"],
  kind: EnrichedPlanAdjustmentChange["kind"] = "reschedule",
): EnrichedPlanAdjustmentChange {
  return {
    planDayId,
    updatedFields: fields,
    rationale: "Because.",
    kind,
    dayLabel: focus,
    baseline: {
      focus,
      mainWorkout: "Prescription",
      accessory: null,
      notes: null,
      scheduledDate: from,
      expectedDurationMin: null,
      expectedRpe: null,
      status: "planned",
      fingerprint: "fp",
    },
    structured: false,
    hasStructureBlocks: false,
  };
}

/** An applied proposal of `changes`, with an undo record for the days in `appliedIds` (all of them by default). */
function proposal(
  changes: EnrichedPlanAdjustmentChange[],
  resolvedAt: Date,
  overrides: Partial<PlanAdjustmentProposal> = {},
  appliedIds: string[] = changes.map((item) => item.planDayId),
): PlanAdjustmentProposal {
  return {
    id: `prop-${resolvedAt.getTime()}`,
    userId: "user-1",
    planId: "plan-1",
    status: "applied",
    summaryMessage: "Done.",
    userRequest: "move it",
    payload: { changes },
    aiSource: null,
    createdAt: resolvedAt,
    resolvedAt,
    applyUndo: { days: appliedIds.map((planDayId) => ({ planDayId })) } as never,
    revertedAt: null,
    ...overrides,
  };
}

// The athlete's report: "Move my long run to Sunday this week", then putting
// the Long Run back on Saturday.
const MOVE_TO_SUNDAY = proposal(
  [
    change("long", "Long Run", "2026-10-05", { scheduledDate: "2026-10-04" }),
    change("rest", "Rest", "2026-10-04", { scheduledDate: "2026-10-05" }),
  ],
  minutesAgo(8),
);
const BACK_TO_SATURDAY = proposal(
  [
    change("long", "Long Run", "2026-10-04", { scheduledDate: "2026-10-03" }),
    change("swb", "Strength and Wall Balls", "2026-10-03", { scheduledDate: "2026-10-04" }),
  ],
  minutesAgo(4),
);

describe("formatRecentPlanChanges", () => {
  it("lists what each applied proposal moved, newest first, with both dates and their weekdays", () => {
    const out = formatRecentPlanChanges([BACK_TO_SATURDAY, MOVE_TO_SUNDAY], NOW);

    expect(out.split("\n")).toEqual([
      "--- RECENT PLAN CHANGES ---",
      "What changed in the athlete's plan from your proposals in the last 14 days, newest first, with each session's date before and after:",
      "- 4 minutes ago, applied: Long Run moved from Sunday 2026-10-04 to Saturday 2026-10-03; Strength and Wall Balls moved from Saturday 2026-10-03 to Sunday 2026-10-04. The athlete can still take it back with Undo on its card.",
      "- 8 minutes ago, applied: Long Run moved from Monday 2026-10-05 to Sunday 2026-10-04; Rest moved from Sunday 2026-10-04 to Monday 2026-10-05. The athlete can still take it back with Undo on its card.",
      `When the athlete asks to undo, revert or put something back, or asks what happened to a session, answer from this list: each "from" date is where that session was. Never ask the athlete for a date or detail listed here. Changes made outside your proposals (a move on the timeline, a missed-session reschedule) are not listed.`,
      "--- END RECENT PLAN CHANGES ---",
    ]);
  });

  it("says when a proposal was undone, and offers no Undo for it", () => {
    const undone = { ...MOVE_TO_SUNDAY, status: "reverted" as const, revertedAt: minutesAgo(2) };

    const out = formatRecentPlanChanges([undone], NOW);

    expect(out).toContain(
      "- 8 minutes ago, applied, then undone 2 minutes ago, so those sessions are back where they were: Long Run moved from Monday 2026-10-05 to Sunday 2026-10-04;",
    );
    expect(out).not.toContain("take it back");
  });

  it("lists only the changes the athlete applied from a proposal applied in part", () => {
    const partial = proposal(MOVE_TO_SUNDAY.payload.changes, minutesAgo(30), {}, ["long"]);

    const out = formatRecentPlanChanges([partial], NOW);

    expect(out).toContain("- 30 minutes ago, applied in part: Long Run moved from Monday 2026-10-05 to Sunday 2026-10-04.");
    expect(out).not.toContain("Rest moved");
  });

  it("says what a change did to a session it didn't move", () => {
    const edits = proposal(
      [
        change("tempo", "Tempo Run", "2026-10-06", { focus: "Rest", mainWorkout: "Complete rest" }, "rest_conversion"),
        change("easy", "Easy Run", "2026-10-07", { focus: "Recovery Jog", mainWorkout: "20min", expectedRpe: 3 }, "workout_update"),
        change("intervals", "Intervals", "2026-10-08", { expectedDurationMin: 40 }, "tune"),
        change("bike", "Bike", "2026-10-09", { scheduledDate: "2026-10-10", mainWorkout: "45min" }, "workout_update"),
      ],
      minutesAgo(3 * 60),
    );

    const out = formatRecentPlanChanges([edits], NOW);

    expect(out).toContain(
      '- 3 hours ago, applied: Tempo Run on Tuesday 2026-10-06: turned into a rest day; Easy Run on Wednesday 2026-10-07: renamed "Recovery Jog", workout rewritten, notes or targets adjusted; Intervals on Thursday 2026-10-08: notes or targets adjusted; Bike moved from Friday 2026-10-09 to Saturday 2026-10-10, workout rewritten.',
    );
  });

  it("stops offering Undo once the card's week has passed", () => {
    const old = { ...MOVE_TO_SUNDAY, resolvedAt: minutesAgo(8 * 24 * 60) };

    const out = formatRecentPlanChanges([old], NOW);

    expect(out).toContain("- 8 days ago, applied: Long Run moved");
    expect(out).not.toContain("take it back");
  });

  it("escapes the plan's own text like any athlete text", () => {
    const marked = proposal([change("x", 'Long Run <3 & "easy"', "2026-10-05", { scheduledDate: "2026-10-04" })], minutesAgo(1));

    expect(formatRecentPlanChanges([marked], NOW)).toContain('Long Run &lt;3 &amp; "easy" moved');
  });

  it("is empty when nothing was applied, or nothing is left to list", () => {
    expect(formatRecentPlanChanges([], NOW)).toBe("");
    expect(formatRecentPlanChanges([{ ...MOVE_TO_SUNDAY, resolvedAt: null }], NOW)).toBe("");
    expect(formatRecentPlanChanges([proposal(MOVE_TO_SUNDAY.payload.changes, minutesAgo(1), {}, [])], NOW)).toBe("");
  });
});

describe("loadRecentPlanChanges", () => {
  beforeEach(() => {
    getRecentlyAppliedMock.mockReset();
  });

  it("reads the last two weeks of applied proposals and formats them", async () => {
    getRecentlyAppliedMock.mockResolvedValueOnce([MOVE_TO_SUNDAY]);

    const out = await loadRecentPlanChanges("user-1", NOW);

    expect(getRecentlyAppliedMock).toHaveBeenCalledWith("user-1", new Date("2026-09-18T10:10:00.000Z"), 8);
    expect(out).toContain("Long Run moved from Monday 2026-10-05 to Sunday 2026-10-04");
  });

  it("leaves the record out when the read fails", async () => {
    getRecentlyAppliedMock.mockRejectedValueOnce(new Error("db down"));

    await expect(loadRecentPlanChanges("user-1", NOW)).resolves.toBe("");
  });
});
