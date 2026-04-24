import { Loader2,Send, Square } from "lucide-react";
import { useCallback,useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
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
}

function getSendTooltip(args: { isLoading: boolean; canStop: boolean; hasText: boolean }): string {
  if (args.isLoading && args.canStop) return "Stop response";
  if (args.hasText) return "Send message";
  return "Type a message to send";
}

export function ChatInput({ onSend, onStop, isLoading, placeholder = "Ask about your training...", seed }: Readonly<ChatInputProps>) {
  const [message, setMessage] = useState("");
  const { toast } = useToast();

  // Re-seed the textarea whenever the caller bumps the nonce, so clicking
  // "Ask coach" repeatedly pre-fills each time even when the text matches
  // the last seed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (seed?.text) setMessage(seed.text);
  }, [seed?.nonce, seed?.text]);

  const handleVoiceResult = useCallback((transcript: string) => {
    setMessage(prev => {
      const separator = prev && !prev.endsWith(" ") ? " " : "";
      return prev + separator + transcript;
    });
  }, []);

  const handleVoiceError = useCallback((msg: string) => {
    toast({ title: "Voice Input", description: msg, variant: "destructive" });
  }, [toast]);

  const { isListening, isSupported, interimTranscript, stopListening, toggleListening } = useVoiceInput({
    onResult: handleVoiceResult,
    onError: handleVoiceError,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
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
    <form onSubmit={handleSubmit} className="flex gap-2 items-end" data-testid="form-chat">
      <div className="flex-1 relative">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? "Listening..." : placeholder}
          className="min-h-[44px] max-h-32 resize-none"
          disabled={isLoading}
          aria-label="Chat message"
          data-testid="input-chat-message"
        />
        {isListening && interimTranscript && (
          <div className="px-3 py-1 text-xs text-muted-foreground italic truncate" data-testid="voice-interim-text">
            {interimTranscript}
          </div>
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
                <Button
                  type="submit"
                  size="icon"
                  disabled={message.trim() === "" || isLoading}
                  data-testid="button-send-message"
                  aria-label="Send message"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent>
              {getSendTooltip({
                isLoading: !!isLoading,
                canStop: !!onStop,
                hasText: message.trim().length > 0,
              })}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </form>
  );
}
