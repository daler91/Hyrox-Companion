import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface VoiceButtonProps {
  isListening: boolean;
  isSupported: boolean;
  onClick: () => void;
  size?: "icon" | "sm" | "default";
  className?: string;
  "data-testid"?: string;
}

export function VoiceButton({ isListening, isSupported, onClick, size = "icon", className, "data-testid": dataTestId }: Readonly<VoiceButtonProps>) {
  // Track whether the user has actually started recording at least once so
  // the live region stays silent on mount. Without this guard, "Recording
  // stopped." is announced spuriously whenever a VoiceButton first renders
  // (and every route transition / multi-mount scenario) because isListening
  // starts as false.
  const hasStartedRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (isListening) {
      hasStartedRef.current = true;
      setAnnouncement("Recording. Speak now.");
    } else if (hasStartedRef.current) {
      setAnnouncement("Recording stopped.");
    }
  }, [isListening]);

  if (!isSupported) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={isListening ? "destructive" : "outline"}
            size={size}
            onClick={onClick}
            className={cn(
              "relative",
              isListening && "animate-pulse",
              className,
            )}
            data-testid={dataTestId || "button-voice-input"}
            aria-label={isListening ? "Stop voice input" : "Start voice input"}
            aria-pressed={isListening}
          >
            {isListening ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isListening ? "Stop recording" : "Use voice input — your browser will ask for mic permission"}</p>
        </TooltipContent>
      </Tooltip>
      {/* SR-only live region — announces state transitions so users who
          can't see the pulsing button know when recording starts/stops,
          including auto-stops from timeout/error paths. Empty on mount;
          only populated after the first real start → stop transition.
          WCAG 4.1.3. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </TooltipProvider>
  );
}
