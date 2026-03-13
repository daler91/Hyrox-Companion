import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2 } from "lucide-react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton } from "@/components/VoiceButton";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, isLoading, placeholder = "Ask about your training..." }: ChatInputProps) {
  const [message, setMessage] = useState("");

  const handleVoiceResult = useCallback((transcript: string) => {
    setMessage(prev => {
      const separator = prev && !prev.endsWith(" ") ? " " : "";
      return prev + separator + transcript;
    });
  }, []);

  const { isListening, isSupported, interimTranscript, stopListening, toggleListening } = useVoiceInput({
    onResult: handleVoiceResult,
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
        <Button
          type="submit"
          size="icon"
          disabled={!message.trim() || isLoading}
          data-testid="button-send-message"
          aria-label="Send message"
          title={!message.trim() ? "Type a message to send" : "Send message"}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-label="Sending message..." />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </form>
  );
}
