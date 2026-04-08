import React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dumbbell, Type, Mic } from "lucide-react";

interface WorkoutModeSelectorProps {
  useTextMode: boolean;
  setUseTextMode: (value: boolean) => void;
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
}

export const WorkoutModeSelector = ({
  useTextMode,
  setUseTextMode,
  isListening,
  isSupported,
  startListening,
  stopListening,
}: Readonly<WorkoutModeSelectorProps>) => {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Workout input mode">
      <Button
        variant={useTextMode ? "outline" : "default"}
        size="sm"
        onClick={() => {
          if (isListening) stopListening();
          setUseTextMode(false);
        }}
        aria-pressed={!useTextMode}
        data-testid="button-mode-exercises"
      >
        <Dumbbell className="h-4 w-4 mr-1" />
        Exercises
      </Button>
      <Button
        variant={useTextMode ? "default" : "outline"}
        size="sm"
        onClick={() => {
          if (isListening) stopListening();
          setUseTextMode(true);
        }}
        aria-pressed={useTextMode}
        data-testid="button-mode-freetext"
      >
        <Type className="h-4 w-4 mr-1" />
        Free Text
      </Button>
      {isSupported && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!useTextMode) setUseTextMode(true);
                if (!isListening) startListening();
              }}
              data-testid="button-mode-voice"
            >
              <Mic className="h-4 w-4 mr-1" />
              Voice
            </Button>
          </TooltipTrigger>
          <TooltipContent>Use voice input</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
