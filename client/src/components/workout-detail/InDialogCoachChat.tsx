import { ArrowLeft, Sparkles } from "lucide-react";
import { useState } from "react";

import { ChatInput, type ChatInputSeed } from "@/components/ChatInput";
import { CoachPanelChatArea } from "@/components/coach/CoachPanelChatArea";
import { Button } from "@/components/ui/button";
import { useChatSession } from "@/hooks/useChatSession";

interface InDialogCoachChatProps {
  readonly focusLabel: string;
  /** Pre-filled first message — bumped on mount via `nonce`. */
  readonly seedText: string;
  readonly onBack: () => void;
}

/**
 * Scoped chat surface that lives inside WorkoutDetailDialogV2's right
 * sidebar. Reuses `useChatSession` (same chat-history query key as the
 * global CoachPanel) so the conversation is the same one the user can
 * continue from the FAB later.
 *
 * Deliberately minimal: back button + compact context label + thread +
 * seeded input. No welcome banner, no quick-action grid, no stats row
 * — those belong in the full CoachPanel. Suggestions aren't wired
 * (they live behind the quick-action "Get workout suggestions" path,
 * which isn't available here).
 */
export function InDialogCoachChat({ focusLabel, seedText, onBack }: InDialogCoachChatProps) {
  const { messages, isLoading, scrollRef, updateAutoScrollMode, sendMessage } = useChatSession({
    useStreaming: true,
  });

  // Seed the input exactly once when the chat surface mounts. Nonce
  // is required by ChatInput to re-seed on demand; for this one-shot
  // flow we never need to re-seed, so any stable value works.
  const [seed] = useState<ChatInputSeed>(() => ({ text: seedText, nonce: 1 }));

  return (
    <section
      className="flex min-h-[400px] max-h-[calc(90vh-14rem)] flex-col overflow-hidden rounded-lg border border-border bg-card"
      aria-label="Coach chat about this workout"
      data-testid="in-dialog-coach-chat"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          onClick={onBack}
          // Block back while a send/stream is still pending. Unmount
          // mid-flight would lose the in-progress turn's local state
          // before `useSaveMessageMutation`'s onSuccess invalidates
          // chat-history, so the next mount would rehydrate without
          // the message the user just sent.
          disabled={isLoading}
          aria-label={isLoading ? "Waiting for coach to finish responding" : "Back to coach take"}
          title={isLoading ? "Waiting for coach to finish…" : undefined}
          data-testid="in-dialog-coach-chat-back"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <Sparkles className="size-3.5 text-primary" aria-hidden />
        <div className="min-w-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className="sr-only">Asking about </span>
          <span className="truncate text-foreground">{focusLabel}</span>
        </div>
      </header>

      <CoachPanelChatArea
        ref={scrollRef}
        messages={messages}
        pendingSuggestions={[]}
        applyingId={null}
        isProcessing={isLoading}
        onViewportScroll={updateAutoScrollMode}
        onApplySuggestion={discardSuggestionEvent}
        onDismissSuggestion={discardSuggestionEvent}
      />

      <div className="border-t border-border p-2">
        <ChatInput
          onSend={(m) => {
            sendMessage(m).catch(() => {
              // Surface errors via the toast that useChatSession's
              // mutation layer already owns — just swallow here so
              // the unhandled rejection doesn't bubble.
            });
          }}
          isLoading={isLoading}
          seed={seed}
        />
      </div>
    </section>
  );
}

// Suggestion callbacks required by `CoachPanelChatArea` but never
// actually fired here — we always pass `pendingSuggestions={[]}` so
// `SuggestionsList` doesn't render any interactable items. Arrow
// expression returning `undefined` keeps the body non-empty without
// using the `void` operator.
const discardSuggestionEvent = (): undefined => undefined;
