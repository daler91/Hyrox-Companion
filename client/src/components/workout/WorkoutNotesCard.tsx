import React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { VoiceButton } from "@/components/VoiceButton";

interface WorkoutNotesCardProps {
  notes: string;
  setNotes: (value: string) => void;
  isNotesListening: boolean;
  isNotesSupported: boolean;
  toggleNotesListening: () => void;
  notesInterim: string;
}

export const WorkoutNotesCard = ({
  notes,
  setNotes,
  isNotesListening,
  isNotesSupported,
  toggleNotesListening,
  notesInterim,
}: Readonly<WorkoutNotesCardProps>) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Notes</CardTitle>
          <VoiceButton
            isListening={isNotesListening}
            isSupported={isNotesSupported}
            onClick={toggleNotesListening}
            data-testid="button-voice-notes"
          />
        </div>
      </CardHeader>
      <CardContent>
        <Textarea
          placeholder="How did the workout feel? Any observations..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-[100px]"
          aria-label="Workout notes"
          data-testid="input-workout-notes"
        />
        {isNotesListening && notesInterim && (
          <p
            className="text-sm text-muted-foreground mt-1 italic"
            data-testid="text-notes-interim"
          >
            {notesInterim}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
