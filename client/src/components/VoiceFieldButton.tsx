import { useCallback } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton } from "@/components/VoiceButton";

interface VoiceFieldButtonProps {
  onTranscript: (text: string) => void;
  size?: "icon" | "sm" | "default";
  className?: string;
}

export function VoiceFieldButton({ onTranscript, size = "icon", className }: VoiceFieldButtonProps) {
  const handleResult = useCallback((transcript: string) => {
    onTranscript(transcript);
  }, [onTranscript]);

  const { isListening, isSupported, toggleListening } = useVoiceInput({
    onResult: handleResult,
  });

  return (
    <VoiceButton
      isListening={isListening}
      isSupported={isSupported}
      onClick={toggleListening}
      size={size}
      className={className}
    />
  );
}
