import type { ChatFeedback } from "@shared/schema";
import { forwardRef, Fragment, type UIEventHandler, useMemo } from "react";

import { ChatMessage } from "@/components/ChatMessage";
import { ChatDaySeparator, SessionSummaryNote } from "@/components/coach/ChatTranscriptMarkers";
import { FactProposalCard } from "@/components/coach/FactProposalCard";
import { InlinePlanProposal } from "@/components/coach/InlinePlanProposal";
import { SuggestionsList } from "@/components/coach/SuggestionsTab";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FactProposalDecision } from "@/hooks/chat/useFactProposalDecision";
import type { Message } from "@/hooks/useChatSession";
import type { PlanProposalView, RagInfo, Suggestion } from "@/lib/api";
import { buildTranscript } from "@/lib/chatTranscript";
import { cn } from "@/lib/utils";

interface CoachPanelChatAreaProps {
  readonly messages: Message[];
  readonly pendingSuggestions: Suggestion[];
  readonly applyingId: string | null;
  readonly suggestionsRagInfo?: RagInfo;
  readonly isProcessing: boolean;
  /** What the coach is doing, beside the typing dots (see chatProgressLabel); "Thinking..." when unset. */
  readonly processingLabel?: string;
  /** The reply streaming in now: its text is announced once it is complete (I21). */
  readonly streamingMessageId?: string | null;
  readonly streamError?: string | null;
  readonly className?: string;
  readonly onViewportScroll?: UIEventHandler<HTMLDivElement>;
  readonly onApplySuggestion: (suggestion: Suggestion) => void;
  readonly onDismissSuggestion: (id: string) => void;
  /**
   * The pending conversational plan-adjustment proposal, or the one this
   * surface just applied (usePlanProposal). Its card sits at the turn that
   * carried it; it trails the chat only when that turn isn't in view (an
   * older page, or a reply saved before it carried one).
   */
  readonly planProposal?: PlanProposalView | null;
  readonly isApplyingProposal?: boolean;
  readonly onApplyProposal?: (proposal: PlanProposalView, planDayIds?: readonly string[]) => void;
  readonly onDismissProposal?: (id: string) => void;
  readonly onUndoProposal?: (proposal: PlanProposalView) => void;
  readonly undoingProposalId?: string | null;
  /** Send a failed message again (see useChatSession.retryMessage). */
  readonly onRetryMessage?: (messageId: string) => void;
  /** Rate a saved coach reply (see useChatSession.rateMessage). */
  readonly onRateMessage?: (messageId: string, feedback: ChatFeedback | null) => void;
  /** Answer a fact the coach offered for the athlete card (see useChatSession.decideFactProposal). */
  readonly onDecideFactProposal?: (messageId: string, decision: FactProposalDecision) => void;
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
      streamingMessageId = null,
      streamError,
      className,
      onViewportScroll,
      onApplySuggestion,
      onDismissSuggestion,
      planProposal,
      isApplyingProposal = false,
      onApplyProposal,
      onDismissProposal,
      onUndoProposal,
      undoingProposalId = null,
      onRetryMessage,
      onRateMessage,
      onDecideFactProposal,
    },
    ref
  ) => {
    const transcript = useMemo(() => buildTranscript(messages), [messages]);
    const pendingCardInChat = planProposal
      ? messages.some((message) => message.proposal?.id === planProposal.id)
      : false;
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
          {transcript.map((item) => {
            if (item.type === "day") return <ChatDaySeparator key={item.key} label={item.label} />;
            if (item.type === "summary") {
              return <SessionSummaryNote key={item.message.id} summary={item.message.content} />;
            }
            const { message } = item;
            return (
              <Fragment key={message.id}>
                <ChatMessage
                  role={message.role}
                  content={message.content}
                  timestamp={message.timestamp}
                  ragInfo={message.ragInfo}
                  safetyNotice={message.safetyNotice}
                  failure={message.failure}
                  // Only a failed reply gets a handler (a fresh closure each
                  // render), so every other message keeps its memoized render
                  // through a stream. Hidden while another send is in flight.
                  onRetry={
                    message.failure?.retry && onRetryMessage && !isProcessing
                      ? () => onRetryMessage(message.id)
                      : undefined
                  }
                  messageId={message.id}
                  streaming={message.id === streamingMessageId}
                  feedback={message.feedback}
                  onFeedback={message.rateable ? onRateMessage : undefined}
                />
                {message.factProposal && !message.failure && onDecideFactProposal && (
                  <FactProposalCard
                    messageId={message.id}
                    proposal={message.factProposal}
                    onDecide={onDecideFactProposal}
                  />
                )}
                {message.proposal && (
                  <InlinePlanProposal
                    snapshot={message.proposal}
                    isApplying={isApplyingProposal}
                    onApply={onApplyProposal}
                    onDismiss={onDismissProposal}
                    onUndo={onUndoProposal}
                    undoingId={undoingProposalId}
                  />
                )}
              </Fragment>
            );
          })}
          <SuggestionsList
            suggestions={pendingSuggestions}
            applyingId={applyingId}
            ragInfo={suggestionsRagInfo}
            onApply={onApplySuggestion}
            onDismiss={onDismissSuggestion}
          />
          {planProposal && !pendingCardInChat && onApplyProposal && onDismissProposal && (
            <InlinePlanProposal
              snapshot={planProposal}
              isApplying={isApplyingProposal}
              onApply={onApplyProposal}
              onDismiss={onDismissProposal}
              onUndo={onUndoProposal}
              undoingId={undoingProposalId}
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
