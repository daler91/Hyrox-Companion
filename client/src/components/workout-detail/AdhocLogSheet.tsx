import type { AllowedImageMimeType, ExerciseSet, ParsedExercise } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ExternalLink, ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { normalizeDurationMinutes } from "@/lib/workoutDuration";
import { serializeWorkoutStructure } from "@/lib/workoutStructureSummary";

import { ExerciseTable } from "./ExerciseTable";
import { PrescriptionEditor } from "./shared/PrescriptionEditor";
import { WorkoutEffortNotes } from "./shared/WorkoutEffortNotes";

interface AdhocLogSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const ADHOC_DRAFT_ID = "adhoc-draft";

const todayStr = () => format(new Date(), "yyyy-MM-dd");

const newRowId = () => crypto.randomUUID();

interface RowSeed {
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  setNumber: number;
  sortOrder: number;
  reps?: number | null;
  weight?: number | null;
  distance?: number | null;
  time?: number | null;
  plannedReps?: number | null;
  plannedWeight?: number | null;
  plannedDistance?: number | null;
  plannedTime?: number | null;
  notes?: string | null;
  confidence?: number | null;
  blockId?: string | null;
  stepNumber?: number | null;
  intervalMinute?: number | null;
  cycleNumber?: number | null;
  stepRole?: string | null;
  groupId?: string | null;
  intensity?: Record<string, unknown> | null;
  load?: Record<string, unknown> | null;
  repMode?: string | null;
  tempo?: Record<string, unknown> | null;
  standards?: Record<string, unknown> | null;
}

function makeAdhocRow(seed: RowSeed): ExerciseSet {
  return {
    id: newRowId(),
    workoutLogId: null,
    planDayId: null,
    exerciseName: seed.exerciseName,
    customLabel: seed.customLabel ?? null,
    category: seed.category,
    setNumber: seed.setNumber,
    reps: seed.reps ?? null,
    weight: seed.weight ?? null,
    distance: seed.distance ?? null,
    time: seed.time ?? null,
    plannedReps: seed.plannedReps ?? null,
    plannedWeight: seed.plannedWeight ?? null,
    plannedDistance: seed.plannedDistance ?? null,
    plannedTime: seed.plannedTime ?? null,
    blockId: seed.blockId ?? null,
    stepNumber: seed.stepNumber ?? null,
    intervalMinute: seed.intervalMinute ?? null,
    cycleNumber: seed.cycleNumber ?? null,
    stepRole: seed.stepRole ?? null,
    groupId: seed.groupId ?? null,
    intensity: seed.intensity ?? null,
    load: seed.load ?? null,
    repMode: seed.repMode ?? null,
    tempo: seed.tempo ?? null,
    standards: seed.standards ?? null,
    notes: seed.notes ?? null,
    confidence: seed.confidence ?? null,
    sortOrder: seed.sortOrder,
  } as ExerciseSet;
}

function flattenParsedToSets(parsed: ParsedExercise[]): ExerciseSet[] {
  const rows: ExerciseSet[] = [];
  let sortOrder = 0;
  for (const exercise of parsed) {
    const sets = exercise.sets && exercise.sets.length > 0
      ? exercise.sets
      : [{
          setNumber: 1,
          reps: exercise.reps,
          weight: exercise.weight,
          distance: exercise.distance,
          time: exercise.time,
          plannedReps: exercise.plannedReps,
          plannedWeight: exercise.plannedWeight,
          plannedDistance: exercise.plannedDistance,
          plannedTime: exercise.plannedTime,
          notes: exercise.notes,
        }];

    for (const set of sets) {
      rows.push(
        makeAdhocRow({
          exerciseName: exercise.exerciseName,
          customLabel: exercise.customLabel,
          category: exercise.category,
          setNumber: set.setNumber ?? 1,
          sortOrder: sortOrder++,
          reps: set.reps,
          weight: set.weight,
          distance: set.distance,
          time: set.time,
          plannedReps: set.plannedReps,
          plannedWeight: set.plannedWeight,
          plannedDistance: set.plannedDistance,
          plannedTime: set.plannedTime,
          notes: set.notes,
          confidence: exercise.confidence,
          blockId: set.blockId,
          stepNumber: set.stepNumber,
          intervalMinute: set.intervalMinute,
          cycleNumber: set.cycleNumber,
          stepRole: set.stepRole,
          groupId: set.groupId,
          intensity: set.intensity,
          load: set.load,
          repMode: set.repMode,
          tempo: set.tempo,
          standards: set.standards,
        }),
      );
    }
  }
  return rows;
}

function setsToParsed(rows: readonly ExerciseSet[]): ParsedExercise[] {
  // Group consecutive rows with the same exerciseName + customLabel into
  // one ParsedExercise (mirrors the server's grouping).
  const grouped: ParsedExercise[] = [];
  for (const row of [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const last = grouped.at(-1);
    const sameGroup =
      last &&
      last.exerciseName === row.exerciseName &&
      (last.customLabel ?? null) === (row.customLabel ?? null);

    const setEntry = {
      setNumber: row.setNumber,
      reps: row.reps ?? undefined,
      weight: row.weight ?? undefined,
      distance: row.distance ?? undefined,
      time: row.time ?? undefined,
      plannedReps: row.plannedReps ?? undefined,
      plannedWeight: row.plannedWeight ?? undefined,
      plannedDistance: row.plannedDistance ?? undefined,
      plannedTime: row.plannedTime ?? undefined,
      notes: row.notes ?? undefined,
    };

    if (sameGroup) {
      last.sets.push(setEntry);
    } else {
      grouped.push({
        exerciseName: row.exerciseName,
        category: row.category,
        customLabel: row.customLabel ?? undefined,
        sets: [setEntry],
      });
    }
  }
  return grouped;
}

/**
 * Sheet-native ad-hoc log surface launched from the timeline FAB. Lets
 * the user create a workout that isn't backed by a planned `planDay` —
 * either by adding rows manually in the same `ExerciseTable` used
 * elsewhere, or by pasting / photographing coach text and parsing it
 * via the existing Gemini parse-only endpoints
 * (api.exercises.parse / parseFromImage). State is in-memory; the
 * workout row is created on save through `api.workouts.create`.
 *
 * Power-user features that the legacy `/log` stepper still has but
 * this sheet intentionally skips for now: voice input, draft
 * persistence to localStorage, structured-EMOM builder. Users who
 * need those can tap "Open full editor" to fall through to /log.
 */
export function AdhocLogSheet({ open, onClose }: AdhocLogSheetProps) {
  const { weightUnit: prefWeightUnit, distanceUnit } = useUnitPreferences();
  const weightUnit: "kg" | "lb" = prefWeightUnit === "kg" ? "kg" : "lb";
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [title, setTitle] = useState("Workout");
  const [date, setDate] = useState(todayStr());
  const [mainWorkout, setMainWorkout] = useState("");
  const [accessory, setAccessory] = useState("");
  const [notes, setNotes] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [exerciseSets, setExerciseSets] = useState<ExerciseSet[]>([]);

  const resetState = () => {
    setTitle("Workout");
    setDate(todayStr());
    setMainWorkout("");
    setAccessory("");
    setNotes("");
    setRpe(null);
    setDurationMinutes("");
    setExerciseSets([]);
  };

  // Re-evaluate todayStr() on every open transition so a long-lived
  // session that survives midnight doesn't prefill yesterday's date.
  // Sheet stays mounted in Timeline, toggled by `open` — without this
  // effect the date set at mount would persist until the user manually
  // changes it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) resetState();
  }, [open]);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleAddSet = (data: AddExerciseSetPayload) => {
    setExerciseSets((prev) => {
      const newRow = makeAdhocRow({
        exerciseName: data.exerciseName,
        customLabel: data.customLabel,
        category: data.category,
        setNumber: data.setNumber ?? prev.length + 1,
        // sortOrder is reassigned below once the insertion index is
        // known; the value here is a placeholder.
        sortOrder: prev.length,
        reps: data.reps,
        weight: data.weight,
        distance: data.distance,
        time: data.time,
        plannedReps: data.plannedReps,
        plannedWeight: data.plannedWeight,
        plannedDistance: data.plannedDistance,
        plannedTime: data.plannedTime,
        notes: data.notes,
        confidence: data.confidence,
      });

      // InlineSetEditor's continuation-add path passes sourceSetId so
      // a "+" tap on an earlier group inserts next to that group
      // instead of dropping a disconnected duplicate at the end —
      // setsToParsed groups by consecutive same exerciseName/customLabel,
      // so position matters for correct grouping at save time.
      const sourceIdx = data.sourceSetId
        ? prev.findIndex((row) => row.id === data.sourceSetId)
        : -1;
      const next = sourceIdx === -1
        ? [...prev, newRow]
        : [...prev.slice(0, sourceIdx + 1), newRow, ...prev.slice(sourceIdx + 1)];
      return next.map((row, i) => ({ ...row, sortOrder: i }));
    });
  };

  const handleUpdateSet = (setId: string, data: PatchExerciseSetPayload) => {
    setExerciseSets((prev) =>
      prev.map((row) => (row.id === setId ? { ...row, ...data } : row)),
    );
  };

  const handleDeleteSet = (setId: string) => {
    setExerciseSets((prev) => prev.filter((row) => row.id !== setId));
  };

  const handleParsed = (source: "text" | "photo", parsed: ParsedExercise[] | undefined) => {
    if (!parsed || parsed.length === 0) {
      toast({
        title: "Nothing parsed",
        description: source === "text"
          ? "AI couldn't pull exercises from that text. Add rows manually or refine the text."
          : "AI couldn't identify exercises in that photo. Try a clearer shot.",
        variant: "destructive",
      });
      return;
    }
    setExerciseSets(flattenParsedToSets(parsed));
    toast({
      title: "Parsed",
      description: `Loaded ${parsed.length} exercise${parsed.length === 1 ? "" : "s"} from ${source}.`,
    });
  };

  const handleParseError = (source: "text" | "photo") => () => {
    toast({
      title: "Parse failed",
      description: source === "text"
        ? "AI couldn't parse that text. Try a clearer version or add rows manually."
        : "AI couldn't parse that photo. Try a clearer shot.",
      variant: "destructive",
    });
  };

  const parseTextMutation = useMutation({
    mutationFn: (text: string) => api.exercises.parse(text),
    onSuccess: (parsed) => handleParsed("text", parsed),
    onError: handleParseError("text"),
  });

  const parseImageMutation = useMutation({
    mutationFn: (payload: { imageBase64: string; mimeType: AllowedImageMimeType }) =>
      api.exercises.parseFromImage(payload),
    onSuccess: (parsed) => handleParsed("photo", parsed),
    onError: handleParseError("photo"),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmedTitle = title.trim() || "Workout";
      const hasStructured = exerciseSets.length > 0;
      const hasFreeText = mainWorkout.trim().length > 0;
      const normalizedDuration = normalizeDurationMinutes(durationMinutes);

      if (!hasStructured && !hasFreeText) {
        return Promise.reject(new Error("Please add at least one exercise or describe your workout."));
      }

      const summary = hasStructured ? serializeWorkoutStructure(exerciseSets) : null;
      return api.workouts.create({
        title: trimmedTitle,
        date,
        focus: trimmedTitle,
        mainWorkout: hasFreeText ? mainWorkout : (summary ?? trimmedTitle),
        accessory: accessory.trim() || null,
        notes: notes.trim() || null,
        rpe: rpe ?? null,
        ...(normalizedDuration != null ? { duration: normalizedDuration } : {}),
        ...(hasStructured ? { exercises: setsToParsed(exerciseSets) } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      // Server flips isAutoCoaching on workout create; the auth-user
      // cache transition is what wakes the coaching-polling effect and
      // schedules follow-up timeline refreshes for AI notes. Mirrors
      // useSaveWorkoutMutation's invalidation set.
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }).catch(() => {});
      toast({ title: "Workout logged", description: "Your workout has been saved." });
      handleClose();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to save workout. Please try again.";
      toast({ title: "Couldn't save", description: message, variant: "destructive" });
    },
  });

  const openFullEditor = () => {
    onClose();
    setLocation("/log");
  };

  const canSave = !saveMutation.isPending && (exerciseSets.length > 0 || mainWorkout.trim().length > 0);

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => !next && handleClose()}
      title="Log a workout"
      description="Add an unplanned workout for any date."
      contentClassName="sm:max-w-2xl"
      testId="adhoc-log-sheet"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="adhoc-title">Title</Label>
            <Input
              id="adhoc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Workout"
              data-testid="adhoc-title-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adhoc-date">Date</Label>
            <Input
              id="adhoc-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayStr()}
              data-testid="adhoc-date-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adhoc-duration-minutes">Total time (minutes)</Label>
            <Input
              id="adhoc-duration-minutes"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="45"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
              data-testid="adhoc-duration-minutes-input"
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <ExerciseTable
            workoutId={ADHOC_DRAFT_ID}
            exerciseSets={exerciseSets}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onUpdateSet={handleUpdateSet}
            onAddSet={handleAddSet}
            onDeleteSet={handleDeleteSet}
            defaultExpanded
          />
          <PrescriptionEditor
            entryId={ADHOC_DRAFT_ID}
            hasSets={exerciseSets.length > 0}
            mainWorkout={mainWorkout}
            accessory={accessory}
            notes={notes}
            showNotes={false}
            onSaveField={(field, value) => {
              const next = value;
              if (field === "mainWorkout") setMainWorkout(next);
              else if (field === "accessory") setAccessory(next);
              else if (field === "notes") setNotes(next);
            }}
            onParseText={() => {
              if (!mainWorkout.trim()) {
                toast({
                  title: "Add coach text first",
                  description: "Paste a workout into the text box, then tap Parse.",
                });
                return;
              }
              parseTextMutation.mutate(mainWorkout);
            }}
            onParseImage={(payload) => parseImageMutation.mutate(payload)}
            isParsingText={parseTextMutation.isPending}
            isParsingImage={parseImageMutation.isPending}
            title="Coach's text / photo"
            compact
          />
        </div>

        <Separator />

        <WorkoutEffortNotes
          rpe={rpe}
          onRpeChange={setRpe}
          note={notes}
          onNoteChange={(next) => setNotes(next ?? "")}
        />

        <div className="space-y-2">
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={() => saveMutation.mutate()}
            disabled={!canSave}
            data-testid="adhoc-save-workout"
          >
            <ListChecks className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Saving…" : "Save workout"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={openFullEditor}
            data-testid="adhoc-open-full-editor"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open full editor (voice, draft saving)
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
