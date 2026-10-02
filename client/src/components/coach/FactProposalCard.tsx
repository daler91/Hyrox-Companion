import type { ChatFactProposal } from "@shared/schema";
import { Check, ClipboardList } from "lucide-react";
import { memo } from "react";

import { ATHLETE_FACT_CATEGORY_LABELS } from "@/components/settings/athlete-card/athleteCardModel";
import { Button } from "@/components/ui/button";
import type { FactProposalDecision } from "@/hooks/chat/useFactProposalDecision";

interface FactProposalCardProps {
  readonly messageId: string;
  readonly proposal: ChatFactProposal;
  /** Stable across renders (useFactProposalDecision), so memo holds through a stream. */
  readonly onDecide: (messageId: string, decision: FactProposalDecision) => void;
}

/**
 * A lasting fact the coach heard in the athlete's message, offered for their
 * athlete card under the reply (AI coach chat review, I5b). Nothing is saved
 * until the athlete says so; once saved it says where it went, and once turned
 * down it is gone.
 */
export const FactProposalCard = memo(function FactProposalCard({ messageId, proposal, onDecide }: FactProposalCardProps) {
  if (proposal.status === "dismissed") return null;
  if (proposal.status === "saved") {
    return (
      <p className="ml-11 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="fact-proposal-saved">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Saved to your athlete card: &ldquo;{proposal.fact}&rdquo;
      </p>
    );
  }
  return (
    <section
      aria-label="Save to your athlete card?"
      className="ml-11 max-w-[80%] space-y-2 rounded-lg border border-dashed bg-muted/40 p-3"
      data-testid="fact-proposal"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
        Save to your athlete card?
      </p>
      <p className="text-sm">
        &ldquo;{proposal.fact}&rdquo;
        <span className="ml-1.5 text-xs text-muted-foreground">
          ({ATHLETE_FACT_CATEGORY_LABELS[proposal.category]})
        </span>
      </p>
      <p className="text-xs text-muted-foreground">
        Your coach plans around what&apos;s on your card in every week. Change it any time in Settings.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onDecide(messageId, "save")}>
          Save to card
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDecide(messageId, "dismiss")}>
          Not now
        </Button>
      </div>
    </section>
  );
});
