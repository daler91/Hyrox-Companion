import { memo } from "react";

import { PlanProposalCard } from "@/components/coach/PlanProposalCard";
import { useLiveProposal } from "@/hooks/usePlanProposal";
import type { PlanProposalView } from "@/lib/api";

interface InlinePlanProposalProps {
  /** The proposal as the chat message carried it; the card shows its current status. */
  readonly snapshot: PlanProposalView;
  readonly isApplying: boolean;
  readonly onApply?: (proposal: PlanProposalView) => void;
  readonly onDismiss?: (id: string) => void;
}

/**
 * A proposal's card at the chat turn that produced it (AI coach chat review,
 * I3), applied, dismissed or still open — instead of a card that floated at
 * the end of the chat while pending and vanished once it was decided.
 */
export const InlinePlanProposal = memo(function InlinePlanProposal({
  snapshot,
  isApplying,
  onApply,
  onDismiss,
}: InlinePlanProposalProps) {
  const proposal = useLiveProposal(snapshot);
  return (
    <PlanProposalCard
      proposal={proposal}
      isApplying={isApplying && proposal.status === "pending"}
      onApply={onApply}
      onDismiss={onDismiss}
    />
  );
});
