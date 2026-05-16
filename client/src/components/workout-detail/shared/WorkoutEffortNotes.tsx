import { useState } from "react";

import { AthleteNoteInput } from "../AthleteNoteInput";
import { RpePrompt } from "./RpePrompt";

interface WorkoutEffortNotesProps {
  readonly rpe: number | null;
  readonly onRpeChange: (next: number | null) => void;
  readonly note: string | null | undefined;
  readonly onNoteChange: (next: string | null) => void;
  /**
   * When true the note input debounces onNoteChange — used by server-bound
   * consumers (ReviewSurface) so a keystroke isn't a PATCH. When false it
   * fires on every keystroke so a local note state is current the instant
   * the user taps the action button. Defaults to false.
   */
  readonly debounceNote?: boolean;
  readonly noteDisabled?: boolean;
}

/**
 * The shared "effort + notes" wrap-up block. RPE and the athlete note sit
 * together, in this order, directly above the action button on every
 * workout surface (LogSheet, AdhocLogSheet, ReviewSurface) so the logging
 * flow looks and behaves identically wherever the user is.
 *
 * RPE keeps a local echo of the selected value so a tap highlights
 * instantly even when the parent's `rpe` prop is server-bound and lags a
 * round-trip — ReviewSurface's updateRpe is deliberately non-optimistic,
 * which previously left a tap looking like it did nothing until the PATCH
 * resolved.
 */
export function WorkoutEffortNotes({
  rpe,
  onRpeChange,
  note,
  onNoteChange,
  debounceNote = false,
  noteDisabled,
}: WorkoutEffortNotesProps) {
  const [rpeEcho, setRpeEcho] = useState(rpe);
  const [lastRpeProp, setLastRpeProp] = useState(rpe);

  // Render-time sync: when the parent's value changes (server confirms a
  // save, or the surface re-mounts on a different workout) adopt it.
  if (rpe !== lastRpeProp) {
    setLastRpeProp(rpe);
    setRpeEcho(rpe);
  }

  const handleRpeChange = (next: number | null) => {
    setRpeEcho(next);
    onRpeChange(next);
  };

  return (
    <div className="space-y-4" data-testid="workout-effort-notes">
      <RpePrompt value={rpeEcho} onChange={handleRpeChange} />
      <AthleteNoteInput
        value={note}
        onSave={onNoteChange}
        mode="form"
        immediate={!debounceNote}
        disabled={noteDisabled}
      />
    </div>
  );
}
