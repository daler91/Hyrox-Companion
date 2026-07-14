import { forwardRef, type UIEventHandler } from "react";

import { ChatMessage } from "@/components/ChatMessage";
import { PlanProposalCard } from "@/components/coach/PlanProposalCard";
import { SuggestionsList } from "@/components/coach/SuggestionsTab";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Message } from "@/hooks/useChatSession";
import type { PlanProposalView, RagInfo, Suggestion } from "@/lib/api";
import { cn } from "@/lib/utils";

interface CoachPanelChatAreaProps {
  readonly messages: Message[];
  readonly pendingSuggestions: Suggestion[];
  readonly applyingId: string | null;
  readonly suggestionsRagInfo?: RagInfo;
  readonly isProcessing: boolean;
  /** Swap the generic "Thinking..." status for a plan-review message. */
  readonly processingLabel?: string;
  readonly streamError?: string | null;
  readonly className?: string;
  readonly onViewportScroll?: UIEventHandler<HTMLDivElement>;
  readonly onApplySuggestion: (suggestion: Suggestion) => void;
  readonly onDismissSuggestion: (id: string) => void;
  /** Pending conversational plan-adjustment proposal, when one exists. */
  readonly planProposal?: PlanProposalView | null;
  readonly isApplyingProposal?: boolean;
  readonly onApplyProposal?: (proposal: PlanProposalView) => void;
  readonly onDismissProposal?: (id: string) => void;
}

export const CoachPanelChatArea = forwardRef<HTMLDivElement, CoachPanelChatAreaProps>(
  (
    {
      messages,
      pendingSuggestions,
      applyingId,
      suggestionsRagInfo,
      isProcessing,
      processingLabel,
      streamError,
      className,
      onViewportScroll,
      onApplySuggestion,
      onDismissSuggestion,
      planProposal,
      isApplyingProposal = false,
      onApplyProposal,
      onDismissProposal,
    },
    ref
  ) => {
    return (
      <>
        {/* Dedicated assertive region for stream interruptions (W8). Kept
            mounted and empty so the announcement fires the moment its text
            changes, instead of being deferred inside the polite log below. */}
        <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
          {streamError ?? ""}
        </div>
        <ScrollArea
          className={cn("min-h-0 flex-1 p-3", className)}
          viewportRef={ref}
          viewportProps={{ onScroll: onViewportScroll }}
        >
        <div className="space-y-3" role="log" aria-live="polite" aria-label="Coach conversation">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
              ragInfo={message.ragInfo}
            />
          ))}
          <SuggestionsList
            suggestions={pendingSuggestions}
            applyingId={applyingId}
            ragInfo={suggestionsRagInfo}
            onApply={onApplySuggestion}
            onDismiss={onDismissSuggestion}
          />
          {planProposal && onApplyProposal && onDismissProposal && (
            <PlanProposalCard
              proposal={planProposal}
              isApplying={isApplyingProposal}
              onApply={onApplyProposal}
              onDismiss={onDismissProposal}
            />
          )}
          {isProcessing && (
            <div className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
              <div className="flex gap-1" aria-hidden="true">
                <span
                  className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
              <span className="text-xs">{processingLabel ?? "Thinking..."}</span>
            </div>
          )}
        </div>
        </ScrollArea>
      </>
    );
  }
);
CoachPanelChatArea.displayName = "CoachPanelChatArea";
