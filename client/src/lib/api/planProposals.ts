import type { EnrichedPlanAdjustmentChange, PlanProposalStatus } from "@shared/schema";

import { typedRequest } from "./client";

/** Serialized proposal as returned by the plan-proposals routes and SSE frames. */
export interface PlanProposalView {
  id: string;
  planId: string;
  status: PlanProposalStatus;
  summaryMessage: string;
  changes: EnrichedPlanAdjustmentChange[];
  createdAt: string;
  /** Applied or undone: the days the apply changed (the athlete may have picked some). */
  appliedPlanDayIds?: string[];
  /** Applied: whether the apply can still be undone. */
  undoable?: boolean;
}

export interface ApplyPlanProposalResponse {
  applied: boolean;
  changeCount?: number;
  reason?: string;
  message?: string;
  staleChanges?: Array<{ planDayId: string; dayLabel: string }>;
}

export interface UndoPlanProposalResponse {
  undone: boolean;
  restoredCount?: number;
  /** Days where something changed since the apply, which the undo left as it is. */
  keptDays?: Array<{ planDayId: string; dayLabel: string }>;
  reason?: string;
  message?: string;
}

export const planProposals = {
  getPending: () =>
    typedRequest<{ proposal: PlanProposalView | null }>("GET", "/api/v1/plan-proposals/pending"),

  /** One proposal with its current status, for a card at the chat turn that produced it. */
  get: (id: string) =>
    typedRequest<{ proposal: PlanProposalView }>("GET", `/api/v1/plan-proposals/${encodeURIComponent(id)}`),

  // The apply can trigger one more AI parse for table-backed days, so give it
  // the same generous budget as the suggestions apply flow. Without
  // `planDayIds`, every change is applied.
  apply: (id: string, planDayIds?: readonly string[]) =>
    typedRequest<ApplyPlanProposalResponse>(
      "POST",
      `/api/v1/plan-proposals/${id}/apply`,
      planDayIds ? { planDayIds } : {},
      { timeoutMs: 90_000 },
    ),

  undo: (id: string) =>
    typedRequest<UndoPlanProposalResponse>("POST", `/api/v1/plan-proposals/${id}/undo`, {}),

  dismiss: (id: string) =>
    typedRequest<{ dismissed: boolean }>("POST", `/api/v1/plan-proposals/${id}/dismiss`, {}),
} as const;
