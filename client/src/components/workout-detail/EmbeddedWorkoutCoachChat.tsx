import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useCallback, useMemo } from "react";

import { ChatInput, type ChatInputSeed } from "@/components/ChatInput";
import { CoachPanelChatArea } from "@/components/coach/CoachPanelChatArea";
import { Button } from "@/components/ui/button";
import { useChatSession } from "@/hooks/useChatSession";
import { groupExerciseSets } from "@/lib/exerciseUtils";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";
import { cn } from "@/lib/utils";

interface EmbeddedWorkoutCoachChatProps {
  readonly entry: TimelineEntry;
  readonly seedText: string;
  readonly seedNonce?: number;
  readonly onBack: () => void;
  readonly backButtonText?: string;
  readonly chatAreaClassName?: string;
  readonly className?: string;
  readonly isHidden?: boolean;
}

export function buildWorkoutCoachSeedMessage(
  entry: TimelineEntry,
  exerciseSets: readonly ExerciseSet[] = [],
): string {
  const focus = entry.focus?.trim() || "this workout";
  const groups = groupExerciseSets([...exerciseSets]);
  const exerciseLabel = groups.length === 1 ? "exercise" : "exercises";
  const setLabel = exerciseSets.length === 1 ? "set" : "sets";
  const stats = groups.length > 0 ? ` (${groups.length} ${exerciseLabel}, ${exerciseSets.length} ${setLabel})` : "";

  return `Can you walk me through your take on my ${focus} workout on ${formatScheduledDate(
    entry.date,
  )}${stats}?`;
}

export function EmbeddedWorkoutCoachChat({
  entry,
  seedText,
  seedNonce = 1,
  onBack,
  backButtonText,
  chatAreaClassName,
  className,
  isHidden = false,
}: EmbeddedWorkoutCoachChatProps) {
  const seed = useMemo<ChatInputSeed>(
    () => ({ text: seedText, nonce: seedNonce }),
    [seedNonce, seedText],
  );

  const {
    messages,
    isLoading,
    isStreaming,
    streamError,
    scrollRef,
    updateAutoScrollMode,
    sendMessage,
    cancelStream,
  } = useChatSession({
    useStreaming: true,
  });

  const handleSend = useCallback(
    (message: string) => {
      sendMessage(message).catch(ignoreAsyncError);
    },
    [sendMessage],
  );

  return (
    <section
      hidden={isHidden}
      className={cn(
        "flex min-h-0 w-full min-w-0 flex-col rounded-lg border border-border bg-card",
        className,
      )}
      aria-label="Coach chat about this workout"
      data-testid="embedded-workout-coach-chat"
    >
      <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size={backButtonText ? "sm" : "icon"}
          className={cn("shrink-0 text-muted-foreground", backButtonText ? "h-8 px-2" : "size-7")}
          onClick={onBack}
          aria-label="Back to workout details"
          data-testid="embedded-workout-coach-chat-back"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backButtonText ? <span>{backButtonText}</span> : null}
        </Button>
        <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 text-xs font-medium uppercase text-muted-foreground">
          <span className="sr-only">Asking about </span>
          <span className="block truncate text-foreground">{entry.focus?.trim() || "This workout"}</span>
        </div>
      </header>

      <CoachPanelChatArea
        ref={scrollRef}
        messages={messages}
        pendingSuggestions={[]}
        applyingId={null}
        isProcessing={isLoading}
        streamError={streamError}
        className={cn("min-h-0 max-h-none flex-1", chatAreaClassName)}
        onViewportScroll={updateAutoScrollMode}
        onApplySuggestion={noopSuggestion}
        onDismissSuggestion={noopId}
      />

      <div className="shrink-0 border-t border-border p-2">
        <ChatInput
          onSend={handleSend}
          onStop={isStreaming ? cancelStream : undefined}
          isLoading={isLoading}
          seed={seed}
        />
      </div>
    </section>
  );
}

function noopSuggestion(): void {
  // Suggestions are not wired inside workout-detail chat.
}

function noopId(): void {
}

function ignoreAsyncError(): undefined {
  return undefined;
}
