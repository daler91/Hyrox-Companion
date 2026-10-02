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
    expect(onApply).toHaveBeenCalledWith(proposal("pending"), undefined);
    // One change: nothing to pick.
    expect(screen.queryByTestId("switch-include-change-day-1")).not.toBeInTheDocument();
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
    ["reverted", "Undone — plan restored"],
  ] as const)("says a %s proposal changed nothing, with its changes folded away", (status, label) => {
    render(<PlanProposalCard proposal={proposal(status)} isApplying={false} onApply={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByTestId("button-apply-plan-proposal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proposal-change-day-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-toggle-proposal-changes"));
    expect(screen.getByTestId("proposal-change-day-1")).toBeInTheDocument();
  });

  describe("with more than one change", () => {
    const SECOND = {
      ...CHANGE,
      planDayId: "day-2",
      kind: "tune",
      dayLabel: "Sat Oct 3 — Intervals",
      updatedFields: { expectedRpe: 6 },
    } as unknown as EnrichedPlanAdjustmentChange;

    function twoChanges(status: PlanProposalView["status"], extra: Partial<PlanProposalView> = {}): PlanProposalView {
      return { ...proposal(status), changes: [CHANGE, SECOND], ...extra };
    }

    it("lets the athlete leave a change out of the apply", () => {
      const onApply = vi.fn();
      render(<PlanProposalCard proposal={twoChanges("pending")} isApplying={false} onApply={onApply} onDismiss={vi.fn()} />);

      expect(screen.getByTestId("button-apply-plan-proposal")).toHaveTextContent("Apply all changes");
      fireEvent.click(screen.getByRole("switch", { name: "Include Thu Oct 1 — Long Run" }));

      const apply = screen.getByTestId("button-apply-plan-proposal");
      expect(apply).toHaveTextContent("Apply 1 change");
      fireEvent.click(apply);
      expect(onApply).toHaveBeenCalledWith(twoChanges("pending"), ["day-2"]);
    });

    it("can't apply with every change left out", () => {
      render(<PlanProposalCard proposal={twoChanges("pending")} isApplying={false} onApply={vi.fn()} onDismiss={vi.fn()} />);

      fireEvent.click(screen.getByTestId("switch-include-change-day-1"));
      fireEvent.click(screen.getByTestId("switch-include-change-day-2"));

      expect(screen.getByTestId("button-apply-plan-proposal")).toBeDisabled();
    });

    it("says which changes an apply left out", () => {
      render(
        <PlanProposalCard proposal={twoChanges("applied", { appliedPlanDayIds: ["day-2"] })} isApplying={false} />,
      );

      expect(screen.getByText("Applied — 1 of 2 changes")).toBeInTheDocument();
      expect(screen.getByTestId("proposal-change-day-1")).toHaveTextContent("Not applied");
      expect(screen.getByTestId("proposal-change-day-2")).not.toHaveTextContent("Not applied");
    });

    it("still says which changes were left out once an apply is undone", () => {
      render(
        <PlanProposalCard proposal={twoChanges("reverted", { appliedPlanDayIds: ["day-2"] })} isApplying={false} />,
      );

      expect(screen.getByText("Undone — plan restored")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("button-toggle-proposal-changes"));
      expect(screen.getByTestId("proposal-change-day-1")).toHaveTextContent("Not applied");
      expect(screen.getByTestId("proposal-change-day-2")).not.toHaveTextContent("Not applied");
    });
  });

  it("offers Undo on an applied proposal that can still be undone", () => {
    const onUndo = vi.fn();
    const applied = { ...proposal("applied"), undoable: true };
    render(<PlanProposalCard proposal={applied} isApplying={false} onUndo={onUndo} />);

    fireEvent.click(screen.getByTestId("button-undo-plan-proposal"));
    expect(onUndo).toHaveBeenCalledWith(applied);
  });

  it("shows the undo in progress", () => {
    render(<PlanProposalCard proposal={{ ...proposal("applied"), undoable: true }} isApplying={false} onUndo={vi.fn()} isUndoing />);

    expect(screen.getByTestId("button-undo-plan-proposal")).toHaveTextContent("Undoing…");
    expect(screen.getByTestId("button-undo-plan-proposal")).toBeDisabled();
  });

  it("offers no Undo once it can't be undone", () => {
    render(<PlanProposalCard proposal={{ ...proposal("applied"), undoable: false }} isApplying={false} onUndo={vi.fn()} />);

    expect(screen.queryByTestId("button-undo-plan-proposal")).not.toBeInTheDocument();
  });
});
