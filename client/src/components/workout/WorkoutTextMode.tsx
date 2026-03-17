import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Mic } from "lucide-react";
import { VoiceButton } from "@/components/VoiceButton";
import { UseMutationResult } from "@tanstack/react-query";

interface WorkoutTextModeProps {
  freeText: string;
  setFreeText: (value: string) => void;
  isListening: boolean;
  isSupported: boolean;
  toggleListening: () => void;
  stopListening: () => void;
  interimTranscript: string;
  parseMutation: UseMutationResult<any, any, string, any>;
  toast: any;
}

export const WorkoutTextMode = ({
  freeText,
  setFreeText,
  isListening,
  isSupported,
  toggleListening,
  stopListening,
  interimTranscript,
  parseMutation,
  toast,
}: WorkoutTextModeProps) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Workout Description</CardTitle>
          <VoiceButton
            isListening={isListening}
            isSupported={isSupported}
            onClick={toggleListening}
            className=""
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isListening && (
          <div
            className="flex items-center gap-2 text-sm text-primary bg-primary/10 rounded-md px-3 py-2"
            data-testid="voice-listening-indicator"
          >
            <Mic className="h-4 w-4 animate-pulse" />
            <span>Listening... speak your workout</span>
          </div>
        )}
        <Textarea
          placeholder={
            isListening
              ? "Listening... describe your workout"
              : "Describe your workout, e.g.:\n4x8 back squat at 70kg\n3x10 bent over rows at 50kg\n5km tempo run in 25 min\n1000m skierg"
          }
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          className="min-h-[120px]"
          data-testid="input-freetext"
        />
        {isListening && interimTranscript && (
          <div
            className="px-3 py-1 text-xs text-muted-foreground italic truncate"
            data-testid="voice-interim-freetext"
          >
            {interimTranscript}
          </div>
        )}
        <Button
          onClick={() => {
            if (isListening) stopListening();
            if (!freeText.trim()) {
              toast({
                title: "No text",
                description: "Please describe your workout first.",
                variant: "destructive",
              });
              return;
            }
            parseMutation.mutate(freeText);
          }}
          disabled={parseMutation.isPending || !freeText.trim()}
          variant="outline"
          className="w-full"
          data-testid="button-parse-ai"
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
            : "AI will convert your text into structured exercises you can review and edit before saving."}
        </p>
      </CardContent>
    </Card>
  );
};
