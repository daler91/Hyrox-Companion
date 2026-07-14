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
}

export interface ApplyPlanProposalResponse {
  applied: boolean;
  changeCount?: number;
  reason?: string;
  message?: string;
  staleChanges?: Array<{ planDayId: string; dayLabel: string }>;
}

export const planProposals = {
  getPending: () =>
    typedRequest<{ proposal: PlanProposalView | null }>("GET", "/api/v1/plan-proposals/pending"),

  // The apply can trigger one more AI parse for table-backed days, so give it
  // the same generous budget as the suggestions apply flow.
  apply: (id: string) =>
    typedRequest<ApplyPlanProposalResponse>(
      "POST",
      `/api/v1/plan-proposals/${id}/apply`,
      {},
      { timeoutMs: 90_000 },
    ),

  dismiss: (id: string) =>
    typedRequest<{ dismissed: boolean }>("POST", `/api/v1/plan-proposals/${id}/dismiss`, {}),
} as const;
