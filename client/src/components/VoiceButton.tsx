import { Button } from "@/components/ui/button";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface VoiceButtonProps {
  isListening: boolean;
  isSupported: boolean;
  onClick: () => void;
  size?: "icon" | "sm" | "default";
  className?: string;
  "data-testid"?: string;
  permissionDenied?: boolean;
}

export function VoiceButton({ isListening, isSupported, onClick, size = "icon", className, "data-testid": dataTestId, permissionDenied }: VoiceButtonProps) {
  if (!isSupported && !permissionDenied) return null;

  return (
    <Button
      type="button"
      variant={isListening ? "destructive" : "outline"}
      size={size}
      onClick={onClick}
      disabled={permissionDenied}
      className={cn(
        "relative",
        isListening && "animate-pulse",
        permissionDenied && "opacity-50",
        className,
      )}
      data-testid={dataTestId || "button-voice-input"}
      aria-label={permissionDenied ? "Microphone access denied" : isListening ? "Stop voice input" : "Start voice input"}
      title={permissionDenied ? "Microphone blocked — allow in browser settings" : isListening ? "Stop recording" : "Use voice input"}
    >
      {isListening ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
