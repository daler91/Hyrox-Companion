import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { ChatInput, type ChatInputSeed } from "@/components/ChatInput";
import { CoachPanelChatArea } from "@/components/coach/CoachPanelChatArea";
import { Button } from "@/components/ui/button";
import { useChatSession } from "@/hooks/useChatSession";
import { groupExerciseSets } from "@/lib/exerciseUtils";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

interface EmbeddedWorkoutCoachChatProps {
  readonly entry: TimelineEntry;
  readonly seedText: string;
  readonly seedNonce?: number;
  readonly onBack: () => void;
  readonly autoScrollIntoView?: boolean;
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
  autoScrollIntoView = false,
}: EmbeddedWorkoutCoachChatProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const seed = useMemo<ChatInputSeed>(
    () => ({ text: seedText, nonce: seedNonce }),
    [seedNonce, seedText],
  );

  const {
    messages,
    isLoading,
    isStreaming,
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

  useEffect(() => {
    if (!autoScrollIntoView) return;
    sectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
  }, [autoScrollIntoView, seedNonce]);

  return (
    <section
      ref={sectionRef}
      className="flex w-full min-w-0 self-start flex-col rounded-lg border border-border bg-card"
      aria-label="Coach chat about this workout"
      data-testid="embedded-workout-coach-chat"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          onClick={onBack}
          aria-label="Back to workout details"
          data-testid="embedded-workout-coach-chat-back"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
        <div className="min-w-0 text-xs font-medium uppercase text-muted-foreground">
          <span className="sr-only">Asking about </span>
          <span className="truncate text-foreground">{entry.focus?.trim() || "This workout"}</span>
        </div>
      </header>

      <CoachPanelChatArea
        ref={scrollRef}
        messages={messages}
        pendingSuggestions={[]}
        applyingId={null}
        isProcessing={isLoading}
        className="max-h-[320px] flex-none"
        onViewportScroll={updateAutoScrollMode}
        onApplySuggestion={noopSuggestion}
        onDismissSuggestion={noopId}
      />

      <div className="border-t border-border p-2">
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
