import type { EnrichedPlanAdjustmentChange } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlanProposalView } from "@/lib/api";

import { PlanProposalCard } from "../PlanProposalCard";

const CHANGE = {
  planDayId: "day-1",
  kind: "reschedule",
  dayLabel: "Thu Oct 1 — Long Run",
  rationale: "Saturday leaves a rest day before the race.",
  updatedFields: { scheduledDate: "2026-10-03" },
  baseline: {
    focus: "Long Run",
    mainWorkout: "90 min easy",
    accessory: null,
    notes: null,
    scheduledDate: "2026-10-01",
    expectedDurationMin: 90,
    expectedRpe: 4,
    status: "planned",
  },
  structured: false,
  hasStructureBlocks: false,
} as unknown as EnrichedPlanAdjustmentChange;

function proposal(status: PlanProposalView["status"]): PlanProposalView {
  return {
    id: "proposal-1",
    planId: "plan-1",
    status,
    summaryMessage: "Moved your long run to Saturday.",
    changes: [CHANGE],
    createdAt: "2026-10-01T10:00:00.000Z",
  };
}

describe("PlanProposalCard", () => {
  it("offers Apply and Dismiss on a pending proposal", () => {
    const onApply = vi.fn();
    render(<PlanProposalCard proposal={proposal("pending")} isApplying={false} onApply={onApply} onDismiss={vi.fn()} />);

    expect(screen.getByText("Proposed plan changes (1 day)")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-apply-plan-proposal"));
    expect(onApply).toHaveBeenCalledWith(proposal("pending"));
  });

  it("shows no actions on a pending proposal where the surface can't act on it", () => {
    render(<PlanProposalCard proposal={proposal("pending")} isApplying={false} />);
    expect(screen.queryByTestId("button-apply-plan-proposal")).not.toBeInTheDocument();
  });

  it("lists what an applied proposal changed, with no actions", () => {
    render(<PlanProposalCard proposal={proposal("applied")} isApplying={false} onApply={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText("Applied — 1 day updated")).toBeInTheDocument();
    expect(screen.getByTestId("proposal-change-day-1")).toBeInTheDocument();
    expect(screen.queryByTestId("button-apply-plan-proposal")).not.toBeInTheDocument();
  });

  it.each([
    ["dismissed", "Dismissed — plan not changed"],
    ["superseded", "Replaced by a newer proposal"],
    ["invalidated", "Out of date — not applied"],
  ] as const)("says a %s proposal changed nothing, with its changes folded away", (status, label) => {
    render(<PlanProposalCard proposal={proposal(status)} isApplying={false} onApply={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByTestId("button-apply-plan-proposal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proposal-change-day-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-toggle-proposal-changes"));
    expect(screen.getByTestId("proposal-change-day-1")).toBeInTheDocument();
  });
});
