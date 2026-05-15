import type { StructureBlockScore } from "@shared/schema";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { buildEmomPreview } from "./emomPreview";
import { type BlockType, type StepType, UNASSIGNED_WORK_STEP_LABEL, type WorkoutSection, type WorkoutStructureConfig } from "./types";

const sections: WorkoutSection[] = ["warmup", "main", "accessory", "cooldown", "mobility"];
// Only the three formats with a dedicated configuration UI are offered.
// A block loaded with any other formatType still displays (see
// `blockTypeOptions`) so legacy data isn't silently dropped.
const SUPPORTED_BLOCK_TYPES: BlockType[] = ["emom", "amrap", "rounds"];
const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  emom: "EMOM",
  amrap: "AMRAP",
  rounds: "Rounds",
  steady: "Steady",
  interval: "Interval",
  for_time: "For time",
};
const stepTypes: StepType[] = ["work", "rest", "transition"];
const MAX_EMOM_DURATION_MINUTES = 240;

function stepEditorHint(blockType: BlockType): string {
  if (blockType === "emom") return "Each step fills one minute of the EMOM, in order.";
  if (blockType === "amrap") return "List each movement in the round — they repeat until the time cap.";
  if (blockType === "rounds") return "List the movements that repeat every round.";
  return "Add the steps that make up this block.";
}

function blockTypeOptionsFor(current: BlockType): BlockType[] {
  return SUPPORTED_BLOCK_TYPES.includes(current)
    ? SUPPORTED_BLOCK_TYPES
    : [current, ...SUPPORTED_BLOCK_TYPES];
}

function emomPatternLabel(alternating: boolean | undefined): string {
  return alternating ? "Rotate steps each minute" : "Same step every minute";
}

function emomPatternHint(alternating: boolean | undefined): string {
  return alternating
    ? "Each minute advances to the next step, looping back to the first."
    : "Every minute runs the first step. Turn on to rotate through multiple steps.";
}

interface Props {
  readonly value: WorkoutStructureConfig;
  readonly onChange: (next: WorkoutStructureConfig) => void;
  readonly showScoreControls?: boolean;
  readonly onScoreChange?: (blockId: string, score: StructureBlockScore | null) => void;
}

type EmomPreview = ReturnType<typeof buildEmomPreview>;
type EmomScore = Extract<StructureBlockScore, { type: "emom" }>;
type AmrapScore = Extract<StructureBlockScore, { type: "amrap" }>;
type RoundsScore = Extract<StructureBlockScore, { type: "rounds" }>;

function emomPreviewStepLabel(step: EmomPreview["minutes"][number]["step"]): string {
  if (step.type === "rest") return "Rest";
  if (step.type === "transition") return "Transition";
  return step.exercise || "Work";
}

function mergeEmomScore(score: WorkoutStructureConfig["score"], patch: Partial<Omit<EmomScore, "type">>): EmomScore {
  const base: EmomScore = score?.type === "emom" ? score : { type: "emom", completed: false };
  return { ...base, ...patch, type: "emom" };
}

function mergeAmrapScore(score: WorkoutStructureConfig["score"], patch: Partial<Omit<AmrapScore, "type">>): AmrapScore {
  const base: AmrapScore = score?.type === "amrap" ? score : { type: "amrap", rounds: 0 };
  return { ...base, ...patch, type: "amrap" };
}

function mergeRoundsScore(score: WorkoutStructureConfig["score"], patch: Partial<Omit<RoundsScore, "type">>): RoundsScore {
  const base: RoundsScore = score?.type === "rounds" ? score : { type: "rounds", completedRounds: 0 };
  return { ...base, ...patch, type: "rounds" };
}

function EmomPreviewContent({ emomPreview }: { readonly emomPreview: EmomPreview }) {
  if (emomPreview.error) {
    return <div className="text-xs text-destructive">{emomPreview.error}</div>;
  }

  if (emomPreview.minutes.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        Set duration and at least one step to preview minutes.
      </div>
    );
  }

  return (
    <>
      <div className="mb-2 text-xs text-muted-foreground">
        {emomPreview.patternLength}-step pattern · {emomPreview.cycleCount} cycle{emomPreview.cycleCount === 1 ? "" : "s"}
      </div>
      <ul className="space-y-1 text-xs">
        {emomPreview.minutes.map(({ minute, step }) => (
          <li key={`emom-minute-${minute}`} className="flex gap-2">
            <span className="w-12 shrink-0 font-mono text-muted-foreground">Min {minute}</span>
            <span className={step.type === "rest" ? "font-medium text-amber-700" : undefined}>
              {emomPreviewStepLabel(step)}
              {step.target ? ` · ${step.target}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function WorkoutStructureEditor({ value, onChange, showScoreControls = false, onScoreChange }: Props) {
  const update = <K extends keyof WorkoutStructureConfig>(key: K, next: WorkoutStructureConfig[K]) => onChange({ ...value, [key]: next });
  const parsePositiveInt = (raw: string, fallback?: number): number | undefined => {
    if (!raw.trim()) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    const normalized = Math.trunc(parsed);
    return normalized > 0 ? normalized : fallback;
  };
  const parseEmomDurationMinutes = (raw: string): number | undefined => {
    if (!raw.trim()) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return undefined;
    const normalized = Math.trunc(parsed);
    if (normalized < 1) return undefined;
    return Math.min(normalized, MAX_EMOM_DURATION_MINUTES);
  };
  const reorderStep = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= value.steps.length) return;
    const steps = [...value.steps];
    const [item] = steps.splice(index, 1);
    steps.splice(destination, 0, item);
    update("steps", steps);
  };
  const addWorkStep = () => update("steps", [
    ...value.steps,
    { id: crypto.randomUUID(), type: "work", exercise: UNASSIGNED_WORK_STEP_LABEL },
  ]);
  const updateScore = (score: StructureBlockScore | null) => {
    const next = { ...value, score };
    if (value.id && onScoreChange) {
      onScoreChange(value.id, score);
      return;
    }
    onChange(next);
  };

  const emomPreview = buildEmomPreview(value);
  const blockTypeOptions = blockTypeOptionsFor(value.blockType);

  return (
    <div className="space-y-3 mb-4 rounded-md border p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label className="text-xs">Format</Label>
          <Select value={value.blockType} onValueChange={(v) => update("blockType", v as BlockType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{blockTypeOptions.map((s) => <SelectItem key={s} value={s}>{BLOCK_TYPE_LABELS[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Section</Label>
          <Select value={value.section} onValueChange={(v) => update("section", v as WorkoutSection)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{sections.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {value.blockType === "emom" && (
        <div className="space-y-2">
          <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Every Minute On the Minute: each minute starts a step. Set the
            total duration, then add the work/rest steps below.
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="text-xs">Duration (min)</Label>
              <Input
                type="number"
                min={1}
                max={MAX_EMOM_DURATION_MINUTES}
                value={value.emomDurationMinutes ?? ""}
                placeholder="e.g. 10"
                onChange={(e) => update("emomDurationMinutes", parseEmomDurationMinutes(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs">Minute pattern</Label>
              <Button
                type="button"
                className="w-full"
                variant={value.emomAlternating ? "default" : "outline"}
                aria-pressed={value.emomAlternating}
                onClick={() => update("emomAlternating", !value.emomAlternating)}
              >
                {emomPatternLabel(value.emomAlternating)}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{emomPatternHint(value.emomAlternating)}</p>
          <div className="rounded border p-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Minute-by-minute preview</div>
            <EmomPreviewContent emomPreview={emomPreview} />
          </div>
        </div>
      )}

      {value.blockType === "amrap" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">AMRAP time cap (min)</Label>
            <Input
              type="number"
              min={1}
              value={value.timeCapMinutes ?? ""}
              placeholder="Minutes"
              onChange={(e) => update("timeCapMinutes", parsePositiveInt(e.target.value))}
            />
          </div>
          <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Add each movement in the AMRAP as a step below.
          </div>
        </div>
      )}

      {value.blockType === "rounds" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Prescribed rounds</Label>
            <Input
              type="number"
              min={1}
              value={value.roundCount ?? ""}
              placeholder="Rounds"
              onChange={(e) => update("roundCount", parsePositiveInt(e.target.value))}
            />
          </div>
          <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Add the movements that repeat each round as steps below.
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div>
          <Label className="text-xs">Steps</Label>
          <p className="text-xs text-muted-foreground">{stepEditorHint(value.blockType)}</p>
        </div>
        {value.steps.map((step, idx) => (
          <div key={step.id} className="grid grid-cols-12 gap-2 items-center rounded border p-2">
            <span className="col-span-1 text-xs text-muted-foreground">{idx + 1}</span>
            <Select value={step.type} onValueChange={(v) => {
              const steps = [...value.steps];
              const nextType = v as StepType;
              const base = { ...steps[idx], type: nextType };
              steps[idx] = nextType === "work" ? base : { ...base, exercise: undefined };
              update("steps", steps);
            }}>
              <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
              <SelectContent>{stepTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            {step.type === "work" ? (
              <div className="col-span-4 min-w-0 text-xs text-muted-foreground">
                {step.exercise && step.exercise !== UNASSIGNED_WORK_STEP_LABEL
                  ? step.exercise
                  : "Assign an exercise row from the table"}
                {step.target ? <span className="block truncate">{step.target}</span> : null}
              </div>
            ) : (
              <div className="col-span-4 text-xs text-muted-foreground">{step.type === "rest" ? "Rest step" : "Transition step"}</div>
            )}
            <Input className="col-span-2" type="number" placeholder="Sec" value={step.durationSeconds ?? ""} onChange={(e) => {
              const steps = [...value.steps];
              const base = { ...steps[idx], durationSeconds: e.target.value ? Number(e.target.value) : undefined };
              steps[idx] = base.type === "work" ? base : { ...base, exercise: undefined };
              update("steps", steps);
            }} />
            <div className="col-span-2 flex gap-1 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => reorderStep(idx, -1)} disabled={idx === 0}>↑</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => reorderStep(idx, 1)} disabled={idx === value.steps.length - 1}>↓</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => update("steps", value.steps.filter((_, i) => i !== idx))}>×</Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addWorkStep}>
          + Add step
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-2">
        <Select value={value.group?.kind ?? "none"} onValueChange={(v) => update("group", v === "none" ? undefined : { kind: v as "superset" | "circuit", restSeconds: value.group?.restSeconds })}>
          <SelectTrigger><SelectValue placeholder="No group" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No group</SelectItem>
            <SelectItem value="superset">Superset</SelectItem>
            <SelectItem value="circuit">Circuit</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Group name" value={value.group?.name ?? ""} onChange={(e) => update("group", value.group ? { ...value.group, name: e.target.value || undefined } : undefined)} />
        <Input type="number" placeholder="Group rest (sec)" value={value.group?.restSeconds ?? ""} onChange={(e) => update("group", value.group ? { ...value.group, restSeconds: e.target.value ? Number(e.target.value) : undefined } : undefined)} />
      </div>

      {showScoreControls && (value.blockType === "emom" || value.blockType === "amrap" || value.blockType === "rounds") && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-medium text-muted-foreground">Block result</div>
          {value.blockType === "emom" && (
            <div className="grid gap-2 md:grid-cols-3">
              <Button
                type="button"
                variant={value.score?.type === "emom" && value.score.completed ? "default" : "outline"}
                onClick={() => updateScore(mergeEmomScore(value.score, { completed: !(value.score?.type === "emom" && value.score.completed) }))}
              >
                Completed
              </Button>
              <Input
                type="number"
                min={0}
                placeholder="Completed min"
                value={value.score?.type === "emom" ? value.score.completedMinutes ?? "" : ""}
                onChange={(e) => updateScore(mergeEmomScore(value.score, { completedMinutes: e.target.value ? Number(e.target.value) : null }))}
              />
              <Input
                type="number"
                min={0}
                placeholder="Missed reps"
                value={value.score?.type === "emom" ? value.score.missedReps ?? "" : ""}
                onChange={(e) => updateScore(mergeEmomScore(value.score, { missedReps: e.target.value ? Number(e.target.value) : null }))}
              />
            </div>
          )}
          {value.blockType === "amrap" && (
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                type="number"
                min={0}
                placeholder="Rounds"
                value={value.score?.type === "amrap" ? value.score.rounds : ""}
                onChange={(e) => updateScore(mergeAmrapScore(value.score, { rounds: Number(e.target.value) || 0 }))}
              />
              <Input
                type="number"
                min={0}
                placeholder="Extra reps"
                value={value.score?.type === "amrap" ? value.score.reps ?? "" : ""}
                onChange={(e) => updateScore(mergeAmrapScore(value.score, { reps: e.target.value ? Number(e.target.value) : null }))}
              />
            </div>
          )}
          {value.blockType === "rounds" && (
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                type="number"
                min={0}
                placeholder="Completed rounds"
                value={value.score?.type === "rounds" ? value.score.completedRounds : ""}
                onChange={(e) => updateScore(mergeRoundsScore(value.score, { completedRounds: Number(e.target.value) || 0 }))}
              />
              <Input
                type="number"
                min={0}
                placeholder="Elapsed seconds"
                value={value.score?.type === "rounds" ? value.score.elapsedSeconds ?? "" : ""}
                onChange={(e) => updateScore(mergeRoundsScore(value.score, { elapsedSeconds: e.target.value ? Number(e.target.value) : null }))}
              />
            </div>
          )}
          <Input
            placeholder="Result notes"
            value={value.score?.notes ?? ""}
            onChange={(e) => {
              const notes = e.target.value || null;
              if (value.blockType === "emom") updateScore(mergeEmomScore(value.score, { notes }));
              if (value.blockType === "amrap") updateScore(mergeAmrapScore(value.score, { notes }));
              if (value.blockType === "rounds") updateScore(mergeRoundsScore(value.score, { notes }));
            }}
          />
        </div>
      )}
    </div>
  );
}
