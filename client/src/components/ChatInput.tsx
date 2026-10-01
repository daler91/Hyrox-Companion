import { CHAT_MESSAGE_MAX_LENGTH } from "@shared/schema";
import { Loader2, Send, Square } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { CharacterCount } from "@/components/ui/character-count";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VoiceButton } from "@/components/VoiceButton";
import { useToast } from "@/hooks/use-toast";
import { useVoiceInput } from "@/hooks/useVoiceInput";

/**
 * Carrier for an externally-seeded prefill. The `nonce` field lets callers
 * re-seed the input with the same `text` on a subsequent click — if we
 * depended on `text` alone, clicking "Ask coach" twice in a row with the
 * same workout wouldn't re-populate after the user cleared the textarea.
 */
export interface ChatInputSeed {
  text: string;
  nonce: number;
}

interface ChatInputProps {
  readonly onSend: (message: string) => void;
  readonly onStop?: () => void;
  readonly isLoading?: boolean;
  readonly placeholder?: string;
  readonly seed?: ChatInputSeed | null;
  /** Longest message the server accepts; defaults to the coach chat's limit. */
  readonly maxLength?: number;
}

/** Show the character count once a message is this close to the limit. */
const COUNTER_THRESHOLD = 0.8;

function getSendTooltip(args: {
  isLoading: boolean;
  canStop: boolean;
  hasText: boolean;
  tooLong: boolean;
}): string {
  if (args.isLoading && args.canStop) return "Stop response";
  if (args.tooLong) return "Message is too long to send";
  if (args.hasText) return "Send message";
  return "Type a message to send";
}

export function ChatInput({
  onSend,
  onStop,
  isLoading,
  placeholder = "Ask about your training...",
  seed,
  maxLength = CHAT_MESSAGE_MAX_LENGTH,
}: Readonly<ChatInputProps>) {
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const counterId = useId();
  // Counted, not truncated: a native maxLength would silently cut a pasted
  // message (and doesn't apply to voice input or a seed). Over the limit, the
  // server refuses the request, so sending is blocked here instead.
  const tooLong = message.length > maxLength;
  const showCounter = message.length > maxLength * COUNTER_THRESHOLD;
  const cannotSend = message.trim() === "" || !!isLoading || tooLong;

  // Re-seed the textarea whenever the caller bumps the nonce, so clicking
  // "Ask coach" repeatedly pre-fills each time even when the text matches
  // the last seed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (seed?.text) setMessage(seed.text);
  }, [seed?.nonce, seed?.text]);

  const handleVoiceResult = useCallback((transcript: string) => {
    setMessage((prev) => {
      const separator = prev && !prev.endsWith(" ") ? " " : "";
      return prev + separator + transcript;
    });
  }, []);

  const handleVoiceError = useCallback(
    (msg: string) => {
      toast({ title: "Voice Input", description: msg, variant: "destructive" });
    },
    [toast],
  );

  const { isListening, isSupported, interimTranscript, stopListening, toggleListening } =
    useVoiceInput({
      onResult: handleVoiceResult,
      onError: handleVoiceError,
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading && !tooLong) {
      if (isListening) stopListening();
      onSend(message.trim());
      setMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex min-w-0 items-end gap-2" data-testid="form-chat">
      <div className="relative min-w-0 flex-1">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? "Listening..." : placeholder}
          className="min-h-[44px] max-h-32 resize-none"
          disabled={isLoading}
          enterKeyHint="send"
          aria-label="Chat message"
          aria-invalid={tooLong || undefined}
          aria-describedby={showCounter ? counterId : undefined}
          data-testid="input-chat-message"
        />
        {isListening && interimTranscript && (
          <div
            className="px-3 py-1 text-xs text-muted-foreground italic truncate"
            data-testid="voice-interim-text"
          >
            {interimTranscript}
          </div>
        )}
        {/* Desktop keyboard-shortcut hint — mobile gets the native enterKeyHint
            cue on the soft keyboard, but desktop users have no equivalent signal
            that Enter sends and Shift+Enter inserts a newline. Hidden during
            voice recording and loading to reduce noise. */}
        {!isListening && !isLoading && (
          <p
            className="hidden px-1 pt-0.5 text-[10px] text-muted-foreground md:block"
            data-testid="text-keyboard-hint"
          >
            <kbd className="font-mono">↵</kbd> send · <kbd className="font-mono">⇧↵</kbd> new line
          </p>
        )}
        {showCounter && (
          <CharacterCount id={counterId} value={message} max={maxLength} className="mt-0 px-1 pt-0.5 text-[10px]" />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <VoiceButton
          isListening={isListening}
          isSupported={isSupported}
          onClick={toggleListening}
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {isLoading && onStop ? (
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  onClick={onStop}
                  data-testid="button-stop-stream"
                  aria-label="Stop AI response"
                >
                  <Square className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                /* Marked aria-disabled rather than disabled: a natively disabled
                   button is neither hoverable nor focusable, so the tooltip
                   explaining *why* it can't be used would never appear. The
                   submit handler already no-ops while there's nothing to send. */
                <Button
                  type="submit"
                  size="icon"
                  aria-disabled={cannotSend}
                  data-testid="button-send-message"
                  aria-label="Send message"
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent>
              {getSendTooltip({
                isLoading: !!isLoading,
                canStop: !!onStop,
                hasText: message.trim().length > 0,
                tooLong,
              })}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </form>
  );
}
