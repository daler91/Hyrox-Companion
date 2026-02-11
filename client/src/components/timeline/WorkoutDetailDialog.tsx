import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  Pencil,
  Trash2,
  Flame,
  Zap,
  Activity,
  TrendingUp,
  Combine,
  Save,
  X,
  Type,
  Dumbbell,
  Sparkles,
} from "lucide-react";
import { SiStrava } from "react-icons/si";
import { type TimelineEntry, type WorkoutStatus, type ExerciseSet, EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { formatSpeed } from "@shared/unitConversion";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { ExerciseInput, createDefaultSet, type StructuredExercise } from "@/components/ExerciseInput";

interface WorkoutDetailDialogProps {
  entry: TimelineEntry | null;
  onClose: () => void;
  onMarkComplete: (entry: TimelineEntry) => void;
  onChangeStatus: (entry: TimelineEntry, status: WorkoutStatus) => void;
  onSave: (updates: { focus: string; mainWorkout: string; accessory: string | null; notes: string | null; exercises?: any[] }) => void;
  onDelete: (entry: TimelineEntry) => void;
  onCombine?: (entry: TimelineEntry) => void;
  isSaving?: boolean;
  isDeleting?: boolean;
}

const categoryChipColors: Record<string, string> = {
  hyrox_station: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  running: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  strength: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  conditioning: "bg-red-500/10 text-red-600 dark:text-red-400",
};

interface GroupedExercise {
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  confidence?: number | null;
  sets: ExerciseSet[];
}

function groupExerciseSets(dbSets: ExerciseSet[]): GroupedExercise[] {
  const sorted = [...dbSets].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const groups: GroupedExercise[] = [];
  let currentKey: string | null = null;
  let currentGroup: GroupedExercise | null = null;
  for (const s of sorted) {
    const key = s.exerciseName === "custom" && s.customLabel
      ? `custom:${s.customLabel}`
      : s.exerciseName;
    if (key !== currentKey) {
      currentGroup = { exerciseName: s.exerciseName, customLabel: s.customLabel, category: s.category, confidence: s.confidence, sets: [] };
      groups.push(currentGroup);
      currentKey = key;
    }
    currentGroup!.sets.push(s);
  }
  return groups;
}

function formatGroupedChip(group: GroupedExercise, weightUnit: string, distanceUnit: string): string {
  const def = EXERCISE_DEFINITIONS[group.exerciseName as ExerciseName];
  const name = group.exerciseName === "custom" && group.customLabel ? group.customLabel : def?.label || group.exerciseName;
  const sets = group.sets;
  if (sets.length === 0) return name;

  const firstSet = sets[0];
  const allSameReps = sets.every(s => s.reps === firstSet.reps);
  const allSameWeight = sets.every(s => s.weight === firstSet.weight);
  const parts: string[] = [];

  if (allSameReps && firstSet.reps && sets.length > 1) {
    parts.push(`${sets.length}x${firstSet.reps}`);
  } else if (firstSet.reps && sets.length === 1) {
    parts.push(`${firstSet.reps}r`);
  } else if (sets.length > 1) {
    parts.push(`${sets.length}s`);
  }

  if (allSameWeight && firstSet.weight) parts.push(`${firstSet.weight}${weightUnit}`);
  else if (!allSameWeight) {
    const weights = Array.from(new Set(sets.map(s => s.weight).filter(Boolean)));
    if (weights.length > 0) parts.push(`${weights.join("/")}${weightUnit}`);
  }

  const dLabel = distanceUnit === "km" ? "m" : "ft";
  if (firstSet.distance) parts.push(`${firstSet.distance}${dLabel}`);
  if (firstSet.time) parts.push(`${firstSet.time}min`);
  return parts.length > 0 ? `${name} ${parts.join(" ")}` : name;
}

function exerciseSetsToStructured(dbSets: ExerciseSet[]): { names: string[]; data: Record<string, StructuredExercise> } {
  const groups = groupExerciseSets(dbSets);
  const names: string[] = [];
  const data: Record<string, StructuredExercise> = {};
  const counter = new Map<string, number>();
  for (const group of groups) {
    const baseName = group.exerciseName === "custom" && group.customLabel
      ? `custom:${group.customLabel}`
      : group.exerciseName;
    const count = (counter.get(baseName) || 0) + 1;
    counter.set(baseName, count);
    const key = `${baseName}__${count}`;
    names.push(key);
    data[key] = {
      exerciseName: group.exerciseName as ExerciseName,
      category: group.category,
      customLabel: group.customLabel || undefined,
      confidence: group.confidence ?? undefined,
      sets: group.sets.map(s => ({
        setNumber: s.setNumber,
        reps: s.reps ?? undefined,
        weight: s.weight ?? undefined,
        distance: s.distance ?? undefined,
        time: s.time ?? undefined,
        notes: s.notes ?? undefined,
      })),
    };
  }
  return { names, data };
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    case "planned":
      return (
        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Clock className="h-3 w-3 mr-1" />
          Planned
        </Badge>
      );
    case "missed":
      return (
        <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
          <XCircle className="h-3 w-3 mr-1" />
          Missed
        </Badge>
      );
    case "skipped":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
          <SkipForward className="h-3 w-3 mr-1" />
          Skipped
        </Badge>
      );
    default:
      return null;
  }
}

export default function WorkoutDetailDialog({
  entry,
  onClose,
  onMarkComplete,
  onChangeStatus,
  onSave,
  onDelete,
  onCombine,
  isSaving,
  isDeleting,
}: WorkoutDetailDialogProps) {
  const { toast } = useToast();
  const { distanceUnit, weightUnit, weightLabel } = useUnitPreferences();
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [useTextMode, setUseTextMode] = useState(false);
  const [editForm, setEditForm] = useState({
    focus: "",
    mainWorkout: "",
    accessory: "",
    notes: "",
  });
  const [editExercises, setEditExercises] = useState<string[]>([]);
  const [editExerciseData, setEditExerciseData] = useState<Record<string, StructuredExercise>>({});
  const hasStructuredData = entry?.exerciseSets && entry.exerciseSets.length > 0;
  const blockCounterRef = useRef(100);

  const makeBlockId = (name: string) => {
    blockCounterRef.current += 1;
    return `${name}__${blockCounterRef.current}`;
  };

  const getBlockExerciseName = (blockId: string): string => {
    const parts = blockId.split("__");
    return parts.slice(0, -1).join("__") || parts[0];
  };

  useEffect(() => {
    if (entry) {
      setEditForm({
        focus: entry.focus,
        mainWorkout: entry.mainWorkout,
        accessory: entry.accessory || "",
        notes: entry.notes || "",
      });
      if (entry.exerciseSets && entry.exerciseSets.length > 0) {
        const { names, data } = exerciseSetsToStructured(entry.exerciseSets);
        setEditExercises(names);
        setEditExerciseData(data);
        setUseTextMode(false);
      } else {
        setEditExercises([]);
        setEditExerciseData({});
        setUseTextMode(true);
      }
      setIsEditing(false);
    }
  }, [entry]);

  const parseMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/parse-exercises", { text });
      return response.json();
    },
    onSuccess: (parsed: Array<{ exerciseName: string; category: string; customLabel?: string; confidence?: number; sets: Array<{ setNumber: number; reps?: number; weight?: number; distance?: number; time?: number }> }>) => {
      if (parsed.length === 0) {
        toast({ title: "No exercises found", description: "AI couldn't identify any exercises. Try being more specific.", variant: "destructive" });
        return;
      }
      const newBlocks: string[] = [];
      const newData: Record<string, StructuredExercise> = {};
      for (const ex of parsed) {
        const rawName = ex.exerciseName as ExerciseName;
        const isKnown = rawName in EXERCISE_DEFINITIONS;
        const exName = isKnown ? rawName : ("custom" as ExerciseName);
        const blockId = makeBlockId(exName === "custom" ? `custom:${ex.customLabel || ex.exerciseName}` : exName);
        newBlocks.push(blockId);
        newData[blockId] = {
          exerciseName: exName,
          category: isKnown ? EXERCISE_DEFINITIONS[rawName].category : ex.category,
          customLabel: isKnown ? undefined : (ex.customLabel || ex.exerciseName),
          confidence: ex.confidence,
          sets: ex.sets.map((s, i) => ({ setNumber: s.setNumber || i + 1, reps: s.reps, weight: s.weight, distance: s.distance, time: s.time })),
        };
      }
      setEditExercises(newBlocks);
      setEditExerciseData(newData);
      setUseTextMode(false);
      const lowConfCount = parsed.filter(e => e.confidence != null && e.confidence < 80).length;
      toast({
        title: "Exercises parsed",
        description: lowConfCount > 0
          ? `Found ${parsed.length} exercise${parsed.length !== 1 ? "s" : ""}. ${lowConfCount} may need review (low confidence).`
          : `Found ${parsed.length} exercise${parsed.length !== 1 ? "s" : ""}. Review below.`,
      });
    },
    onError: () => {
      toast({ title: "Parsing failed", description: "AI couldn't parse your text. Try again or enter manually.", variant: "destructive" });
    },
  });

  if (!entry) return null;

  const hasPlanDayId = !!entry.planDayId;
  const hasWorkoutLogId = !!entry.workoutLogId;
  const canEdit = hasPlanDayId || hasWorkoutLogId;
  const canDelete = hasPlanDayId || hasWorkoutLogId;
  const canChangeStatus = hasPlanDayId;
  const grouped = hasStructuredData ? groupExerciseSets(entry.exerciseSets!) : [];

  const handleAddExercise = (name: ExerciseName) => {
    const blockId = makeBlockId(name);
    const def = EXERCISE_DEFINITIONS[name];
    setEditExercises(prev => [...prev, blockId]);
    setEditExerciseData(prev => ({
      ...prev,
      [blockId]: { exerciseName: name, category: def.category, sets: [createDefaultSet(1)] },
    }));
  };

  const handleRemoveBlock = (blockId: string) => {
    setEditExercises(prev => prev.filter(b => b !== blockId));
    setEditExerciseData(prev => {
      const newData = { ...prev };
      delete newData[blockId];
      return newData;
    });
  };

  const getSelectedExerciseNames = (): ExerciseName[] => {
    return editExercises.map(blockId => {
      const baseName = getBlockExerciseName(blockId);
      return (baseName.startsWith("custom:") ? "custom" : baseName) as ExerciseName;
    });
  };

  const handleSave = () => {
    if (useTextMode) {
      onSave({
        focus: editForm.focus,
        mainWorkout: editForm.mainWorkout,
        accessory: editForm.accessory || null,
        notes: editForm.notes || null,
        exercises: [],
      });
    } else {
      const exercises = editExercises.map((name) => editExerciseData[name]).filter(Boolean);
      const distLabel = distanceUnit === "km" ? "m" : "ft";
      const mainWorkout = exercises.length > 0
        ? exercises.map((ex) => {
            const def = EXERCISE_DEFINITIONS[ex.exerciseName];
            const name = ex.exerciseName === "custom" && ex.customLabel ? ex.customLabel : def?.label || ex.exerciseName;
            const sets = ex.sets || [];
            if (sets.length === 0) return `${name}: completed`;
            const firstSet = sets[0];
            const allSame = sets.every(s => s.reps === firstSet.reps && s.weight === firstSet.weight);
            const parts: string[] = [];
            if (allSame && sets.length > 1 && firstSet.reps) parts.push(`${sets.length}x${firstSet.reps}`);
            else if (firstSet.reps) parts.push(`${firstSet.reps} reps`);
            if (allSame && firstSet.weight) parts.push(`${firstSet.weight}${weightLabel}`);
            if (firstSet.distance) parts.push(`${firstSet.distance}${distLabel}`);
            if (firstSet.time) parts.push(`${firstSet.time}min`);
            return `${name}: ${parts.join(", ") || "completed"}`;
          }).join("; ")
        : editForm.mainWorkout;

      onSave({
        focus: editForm.focus,
        mainWorkout,
        accessory: editForm.accessory || null,
        notes: editForm.notes || null,
        exercises: exercises.length > 0 ? exercises.map(ex => ({
          exerciseName: ex.exerciseName,
          customLabel: ex.customLabel,
          category: ex.category,
          confidence: ex.confidence,
          sets: (ex.sets || []).map(s => ({
            setNumber: s.setNumber,
            reps: s.reps,
            weight: s.weight,
            distance: s.distance,
            time: s.time,
            notes: s.notes,
          })),
        })) : undefined,
      });
    }
  };

  const handleClose = () => {
    setIsEditing(false);
    setConfirmingDelete(false);
    onClose();
  };

  const handleDeleteClick = () => {
    setConfirmingDelete(true);
  };

  const handleConfirmDelete = () => {
    onDelete(entry);
    setConfirmingDelete(false);
  };

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            {getStatusBadge(entry.status)}
            {entry.source === "strava" && (
              <Badge className="bg-[#FC4C02]/10 text-[#FC4C02]">
                <SiStrava className="h-3 w-3 mr-1" />
                Strava
              </Badge>
            )}
            {entry.dayName && (
              <Badge variant="secondary">{entry.dayName}</Badge>
            )}
          </div>
          <DialogTitle className="text-left mt-2">
            {isEditing ? "Edit Workout" : entry.focus}
          </DialogTitle>
          <DialogDescription className="sr-only">
            View and manage workout details
          </DialogDescription>
        </DialogHeader>

        {isEditing ? (
          <div className="space-y-4">
            <div>
              <Label htmlFor="detail-focus">Focus</Label>
              <Input
                id="detail-focus"
                value={editForm.focus}
                onChange={(e) => setEditForm({ ...editForm, focus: e.target.value })}
                data-testid="input-detail-focus"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={useTextMode ? "outline" : "default"}
                size="sm"
                onClick={() => setUseTextMode(false)}
                data-testid="button-mode-exercises"
              >
                <Dumbbell className="h-4 w-4 mr-1" />
                Exercises
              </Button>
              <Button
                variant={useTextMode ? "default" : "outline"}
                size="sm"
                onClick={() => setUseTextMode(true)}
                data-testid="button-mode-freetext"
              >
                <Type className="h-4 w-4 mr-1" />
                Free Text
              </Button>
            </div>

            {useTextMode ? (
              <div className="space-y-3">
                <Textarea
                  id="detail-main"
                  value={editForm.mainWorkout}
                  onChange={(e) => setEditForm({ ...editForm, mainWorkout: e.target.value })}
                  rows={3}
                  data-testid="input-detail-main"
                  placeholder={"Describe your workout, e.g.:\n4x8 back squat at 70kg\n5km tempo run in 25 min"}
                />
                <Button
                  onClick={() => {
                    if (!editForm.mainWorkout.trim()) {
                      toast({ title: "No text", description: "Please describe your workout first.", variant: "destructive" });
                      return;
                    }
                    parseMutation.mutate(editForm.mainWorkout);
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
                  AI will convert your text into structured exercises you can review and edit.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Click an exercise to add it. You can add the same exercise multiple times.</p>
                  <ExerciseSelector
                    selectedExercises={getSelectedExerciseNames()}
                    onToggle={() => {}}
                    onAdd={handleAddExercise}
                    allowDuplicates
                  />
                </div>
                {editExercises.length > 0 && (
                  <div className="space-y-3">
                    {editExercises.map((blockId, idx) => {
                      const exData = editExerciseData[blockId];
                      if (!exData) return null;
                      const exName = exData.exerciseName;
                      const blockCount = editExercises.filter(b => editExerciseData[b]?.exerciseName === exName).length;
                      const blockIndex = editExercises.filter((b, i) => i <= idx && editExerciseData[b]?.exerciseName === exName).length;
                      const showBlockNumber = blockCount > 1;
                      return (
                        <ExerciseInput
                          key={blockId}
                          exercise={exData}
                          onChange={(ex) => setEditExerciseData(prev => ({ ...prev, [blockId]: ex }))}
                          onRemove={() => handleRemoveBlock(blockId)}
                          weightUnit={weightUnit}
                          distanceUnit={distanceUnit}
                          blockLabel={showBlockNumber ? `#${blockIndex}` : undefined}
                        />
                      );
                    })}
                  </div>
                )}
                {editExercises.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    Add exercises using the button above
                  </p>
                )}
              </>
            )}

            <div>
              <Label htmlFor="detail-accessory">Accessory/Engine Work</Label>
              <Textarea
                id="detail-accessory"
                value={editForm.accessory}
                onChange={(e) => setEditForm({ ...editForm, accessory: e.target.value })}
                rows={2}
                data-testid="input-detail-accessory"
              />
            </div>
            <div>
              <Label htmlFor="detail-notes">Notes</Label>
              <Input
                id="detail-notes"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                data-testid="input-detail-notes"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {hasStructuredData ? (
              <div className="flex flex-wrap gap-1.5" data-testid="detail-exercise-chips">
                {grouped.map((group, idx) => (
                  <Badge
                    key={`${group.exerciseName}-${idx}`}
                    variant="secondary"
                    className={`text-xs font-normal ${categoryChipColors[group.category] || ""}`}
                  >
                    {formatGroupedChip(group, weightLabel, distanceUnit)}
                  </Badge>
                ))}
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground">{entry.mainWorkout}</p>
              </div>
            )}
            {entry.accessory && (
              <div>
                <p className="text-xs font-medium text-muted-foreground/70 mb-1">Accessory</p>
                <p className="text-sm text-muted-foreground/70">{entry.accessory}</p>
              </div>
            )}
            {entry.notes && (
              <div>
                <p className="text-xs font-medium text-muted-foreground/70 mb-1">Notes</p>
                <p className="text-sm text-muted-foreground italic">{entry.notes}</p>
              </div>
            )}
            {entry.duration && entry.source !== "strava" && (
              <p className="text-xs text-muted-foreground">
                Duration: {entry.duration} min
                {entry.rpe && ` | RPE: ${entry.rpe}`}
              </p>
            )}
            {entry.source === "strava" && (entry.calories || entry.avgWatts || entry.sufferScore || entry.avgCadence || entry.avgSpeed) && (
              <div className="flex flex-wrap gap-3 pt-2 border-t border-border/50">
                {entry.calories && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Flame className="h-3 w-3 text-orange-500" />
                    <span>{entry.calories} cal</span>
                  </div>
                )}
                {entry.avgWatts && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Zap className="h-3 w-3 text-yellow-500" />
                    <span>{entry.avgWatts}W</span>
                  </div>
                )}
                {entry.avgCadence && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Activity className="h-3 w-3 text-blue-500" />
                    <span>{Math.round(entry.avgCadence)} spm</span>
                  </div>
                )}
                {entry.avgSpeed && entry.avgSpeed > 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="h-3 w-3 text-green-500" />
                    <span>{formatSpeed(entry.avgSpeed, distanceUnit)}</span>
                  </div>
                )}
                {entry.sufferScore && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="h-3 w-3 text-purple-500" />
                    <span>Effort: {entry.sufferScore}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {canChangeStatus && !isEditing && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Change Status</p>
              <div className="flex flex-wrap gap-2">
                {entry.status !== "completed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-600 border-green-200 dark:border-green-800"
                    onClick={() => onMarkComplete(entry)}
                    data-testid="button-detail-complete"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Complete
                  </Button>
                )}
                {entry.status !== "skipped" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-yellow-600 border-yellow-200 dark:border-yellow-800"
                    onClick={() => onChangeStatus(entry, "skipped")}
                    data-testid="button-detail-skip"
                  >
                    <SkipForward className="h-4 w-4 mr-1" />
                    Skip
                  </Button>
                )}
                {entry.status !== "missed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 dark:border-red-800"
                    onClick={() => onChangeStatus(entry, "missed")}
                    data-testid="button-detail-missed"
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Missed
                  </Button>
                )}
                {entry.status !== "planned" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-blue-600 border-blue-200 dark:border-blue-800"
                    onClick={() => onChangeStatus(entry, "planned")}
                    data-testid="button-detail-planned"
                  >
                    <Clock className="h-4 w-4 mr-1" />
                    Planned
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {isEditing ? (
            <>
              <Button
                variant="outline"
                onClick={() => setIsEditing(false)}
                className="sm:mr-auto"
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                data-testid="button-detail-save"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save Changes
              </Button>
            </>
          ) : (
            <>
              <div className="flex gap-2 sm:mr-auto flex-wrap">
                {canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                    data-testid="button-detail-edit"
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
                {onCombine && (
                  <Button
                    variant="outline"
                    onClick={() => onCombine(entry)}
                    data-testid="button-detail-combine"
                  >
                    <Combine className="h-4 w-4 mr-1" />
                    Combine
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={handleDeleteClick}
                    disabled={isDeleting}
                    data-testid="button-detail-delete"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-1" />
                    )}
                    Delete
                  </Button>
                )}
              </div>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this workout? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {isDeleting ? "Deleting..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
