import { parseCoachNotes, splitCoachCueLabel } from "@shared/coachNotes";
import { Sparkles } from "lucide-react";
import { useMemo } from "react";

interface WorkoutNotesProps {
  readonly entryId: string;
  readonly notes: string;
}

/**
 * A day's notes, split into what the athlete wrote and the coach's cues.
 *
 * The coach appends one `[AI Coach]` line per cue, and every auto-coach run
 * used to append again, so rendering the raw text gave one long italic
 * paragraph with the same instruction repeated. Parsing dedupes those cues
 * (including in notes written before the server deduped them) and lists each
 * once, under the athlete's own text.
 */
export function WorkoutNotes({ entryId, notes }: Readonly<WorkoutNotesProps>) {
  const { athleteText, cues } = useMemo(() => parseCoachNotes(notes), [notes]);
  if (!athleteText && cues.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
      {athleteText && (
        <p className="italic whitespace-pre-line" data-testid={`text-notes-${entryId}`}>
          {athleteText}
        </p>
      )}
      {cues.length > 0 && (
        <div data-testid={`coach-cues-${entryId}`}>
          <p className="flex items-center gap-1 font-medium">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Coach cues
          </p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
            {cues.map((cue) => {
              const { label, text } = splitCoachCueLabel(cue);
              return (
                <li key={cue}>
                  {label && <span className="font-medium text-foreground">{label}: </span>}
                  {text}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
