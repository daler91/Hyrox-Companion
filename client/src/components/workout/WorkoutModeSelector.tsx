import React from "react";
import { Button } from "@/components/ui/button";
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
}: WorkoutModeSelectorProps) => {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant={useTextMode ? "outline" : "default"}
        size="sm"
        onClick={() => {
          if (isListening) stopListening();
          setUseTextMode(false);
        }}
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
        data-testid="button-mode-freetext"
      >
        <Type className="h-4 w-4 mr-1" />
        Free Text
      </Button>
      {isSupported && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!useTextMode) setUseTextMode(true);
            if (!isListening) startListening();
          }}
          data-testid="button-mode-voice"
          title="Use voice input"
        >
          <Mic className="h-4 w-4 mr-1" />
          Voice
        </Button>
      )}
    </div>
  );
};
