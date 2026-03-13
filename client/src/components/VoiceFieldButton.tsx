import { useCallback } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { VoiceButton } from "@/components/VoiceButton";
import { useToast } from "@/hooks/use-toast";

interface VoiceFieldButtonProps {
  onTranscript: (text: string) => void;
  onStopRef?: React.MutableRefObject<(() => void) | null>;
  size?: "icon" | "sm" | "default";
  className?: string;
  "data-testid"?: string;
}

export function VoiceFieldButton({ onTranscript, onStopRef, size = "icon", className, "data-testid": dataTestId }: VoiceFieldButtonProps) {
  const { toast } = useToast();

  const handleResult = useCallback((transcript: string) => {
    onTranscript(transcript);
  }, [onTranscript]);

  const handleError = useCallback((message: string) => {
    toast({ title: "Voice Input", description: message, variant: "destructive" });
  }, [toast]);

  const handlePermissionDenied = useCallback(() => {
    toast({ title: "Voice Input", description: "Microphone access is blocked. Please allow microphone permissions in your browser settings (click the lock icon in the address bar) and reload the page.", variant: "destructive" });
  }, [toast]);

  const { isListening, isSupported, permissionDenied, stopListening, toggleListening } = useVoiceInput({
    onResult: handleResult,
    onError: handleError,
  });

  if (onStopRef) {
    onStopRef.current = stopListening;
  }

  return (
    <VoiceButton
      isListening={isListening}
      isSupported={isSupported}
      permissionDenied={permissionDenied}
      onClick={toggleListening}
      onPermissionDeniedClick={handlePermissionDenied}
      size={size}
      className={className}
      data-testid={dataTestId}
    />
  );
}
