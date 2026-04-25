import { Mic, MicOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface VoiceButtonProps {
  isListening: boolean;
  isSupported: boolean;
  onClick: () => void;
  size?: "icon" | "icon-touch" | "sm" | "default";
  className?: string;
  "data-testid"?: string;
}

export function VoiceButton({ isListening, isSupported, onClick, size = "icon", className, "data-testid": dataTestId }: Readonly<VoiceButtonProps>) {
  // Derive the live-region announcement from an actual transition (not
  // just the current state) so SRs don't hear "Recording stopped." every
  // time VoiceButton mounts with isListening=false.
  //
  // This uses the React-sanctioned "store info from previous render"
  // pattern (react.dev/reference/react/useState#storing-information-from-
  // previous-renders): seed prevListening from the initial prop so the
  // first render sees no transition, then update both snapshots when the
  // prop actually changes. setState-during-render is allowed here because
  // it's strictly conditional and terminates.
  const [announcement, setAnnouncement] = useState("");
  const [prevListening, setPrevListening] = useState(isListening);
  if (isListening !== prevListening) {
    setPrevListening(isListening);
    setAnnouncement(isListening ? "Recording. Speak now." : "Recording stopped.");
  }

  if (!isSupported) {
    // Render a disabled hint instead of silently hiding so users on iOS
    // Safari and other browsers without SpeechRecognition know why voice
    // input isn't available, rather than wondering if it's a bug.
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size={size}
              disabled
              className={cn("relative opacity-50", className)}
              data-testid={dataTestId || "button-voice-input"}
              aria-label="Voice input not supported in this browser"
            >
              <MicOff className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Voice input isn&apos;t supported in this browser. Try Chrome or Edge.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

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
