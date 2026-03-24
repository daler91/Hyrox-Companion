import React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Mic } from "lucide-react";
import { VoiceButton } from "@/components/VoiceButton";
import type { WorkoutTextModeProps } from "./types";

export const WorkoutTextMode = React.memo(function WorkoutTextMode({
  editForm,
  setEditForm,
  isMainListening,
  isSupported,
  mainInterim,
  startMainListening: _startMainListening,
  stopMainListening,
  toggleMainListening,
  onParseText,
  parseMutation,
}: Readonly<WorkoutTextModeProps>) {
  return (
    <div className="space-y-3">
      {isMainListening && (
        <div
          className="flex items-center gap-2 text-sm text-primary bg-primary/10 rounded-md px-3 py-2"
          data-testid="voice-detail-listening-indicator"
        >
          <Mic className="h-4 w-4 animate-pulse" />
          <span>Listening... speak your workout</span>
        </div>
      )}
      <div className="relative">
        <Textarea
          id="detail-main"
          value={editForm.mainWorkout}
          onChange={(e) => setEditForm({ ...editForm, mainWorkout: e.target.value })}
          rows={3}
          data-testid="input-detail-main"
          placeholder={
            isMainListening
              ? "Listening... describe your workout"
              : "Describe your workout, e.g.:\n4x8 back squat at 70kg\n5km tempo run in 25 min"
          }
        />
        {isMainListening && mainInterim && (
          <div
            className="px-3 py-1 text-xs text-muted-foreground italic truncate"
            data-testid="voice-detail-interim"
          >
            {mainInterim}
          </div>
        )}
        <VoiceButton
          isListening={isMainListening}
          isSupported={isSupported}
          onClick={toggleMainListening}
          className="absolute top-2 right-2"
        />
      </div>
      <Button
        onClick={() => {
          if (isMainListening) stopMainListening();
          onParseText();
        }}
        disabled={parseMutation.isPending || !editForm.mainWorkout.trim()}
        variant="outline"
        className="w-full"
        data-testid="button-detail-parse-ai"
      >
        {parseMutation.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 mr-2" />
        )}
        {parseMutation.isPending ? "Parsing with AI..." : "Parse with AI"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {isSupported
          ? "Use the microphone to dictate your workout, or type it. AI will convert it into structured exercises."
          : "AI will convert your text into structured exercises you can review and edit."}
      </p>
    </div>
  );
});
