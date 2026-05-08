import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { buildEmomPreview } from "./emomPreview";
import { workoutStructureFeatureFlags } from "./featureFlags";
import type { BlockType, StepType, WorkoutSection, WorkoutStructureConfig } from "./types";

const sections: WorkoutSection[] = ["warmup", "main", "accessory", "cooldown", "mobility"];
const blockTypes: BlockType[] = ["steady", "emom", "rounds", "amrap", "interval", "for_time"];
const stepTypes: StepType[] = ["work", "rest", "transition"];
const MAX_EMOM_DURATION_MINUTES = 240;

interface Props {
  readonly value: WorkoutStructureConfig;
  readonly onChange: (next: WorkoutStructureConfig) => void;
}

type EmomPreview = ReturnType<typeof buildEmomPreview>;

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
        Pattern length: {emomPreview.patternLength} min · Cycle count: {emomPreview.cycleCount}
      </div>
      <ul className="space-y-1 text-xs">
        {emomPreview.minutes.map(({ minute, cycle, step }) => (
          <li key={`emom-minute-${minute}`} className={step.type === "rest" ? "font-medium text-amber-700" : undefined}>
            Min {minute} (Cycle {cycle}): {step.type.toUpperCase()}{step.exercise ? ` · ${step.exercise}` : ""}{step.target ? ` · ${step.target}` : ""}
          </li>
        ))}
      </ul>
    </>
  );
}

export function WorkoutStructureEditor({ value, onChange }: Props) {
  const update = <K extends keyof WorkoutStructureConfig>(key: K, next: WorkoutStructureConfig[K]) => onChange({ ...value, [key]: next });
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
  const addWorkStep = () => update("steps", [...value.steps, { id: crypto.randomUUID(), type: "work" }]);
  const enableEmomBlock = () => {
    onChange({
      ...value,
      blockType: "emom",
      emomDurationMinutes: value.emomDurationMinutes ?? 10,
      emomAlternating: value.emomAlternating ?? false,
      steps: value.steps.length > 0 ? value.steps : [{ id: crypto.randomUUID(), type: "work" }],
    });
  };

  const emomPreview = buildEmomPreview(value);

  return (
    <div className="space-y-3 mb-4 rounded-md border p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label className="text-xs">Section</Label>
          <Select value={value.section} onValueChange={(v) => update("section", v as WorkoutSection)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{sections.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Block type</Label>
          <Select value={value.blockType} onValueChange={(v) => update("blockType", v as BlockType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{blockTypes.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {value.blockType === "emom" && (
        <div className="space-y-2">
          <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            EMOM is configured as a block, not a single exercise.
          </div>
          <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">EMOM duration (min)</Label>
            <Input type="number" min={1} max={MAX_EMOM_DURATION_MINUTES} value={value.emomDurationMinutes ?? ""} placeholder="Minutes" onChange={(e) => update("emomDurationMinutes", parseEmomDurationMinutes(e.target.value))} />
          </div>
          <Button type="button" variant={value.emomAlternating ? "default" : "outline"} onClick={() => update("emomAlternating", !value.emomAlternating)}>
            Alternating steps
          </Button>
        </div>
          <div className="rounded border p-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Minute-step list</div>
            <EmomPreviewContent emomPreview={emomPreview} />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Step editor</Label>
          {value.blockType !== "emom" && (
            <Button type="button" variant="secondary" size="sm" onClick={enableEmomBlock}>
              Add Block → EMOM
            </Button>
          )}
        </div>
        {value.blockType !== "emom" && (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Want an EMOM? Use <span className="font-medium text-foreground">Add Block → EMOM</span> to configure it as a block.
          </div>
        )}
        {value.steps.map((step, idx) => (
          <div key={step.id} className="grid grid-cols-12 gap-2 items-center rounded border p-2">
            <span className="col-span-1 text-xs text-muted-foreground">{idx + 1}</span>
            <Select value={step.type} onValueChange={(v) => {
              const steps = [...value.steps];
              const nextType = v as StepType;
              const base = { ...steps[idx], type: nextType };
              steps[idx] = nextType === "work" ? base : { ...base, exercise: undefined, target: undefined };
              update("steps", steps);
            }}>
              <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
              <SelectContent>{stepTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            {step.type === "work" ? (
              <>
                <Input className="col-span-3" placeholder="Exercise" value={step.exercise ?? ""} onChange={(e) => {
                  const steps = [...value.steps];
                  steps[idx] = { ...steps[idx], exercise: e.target.value || undefined };
                  update("steps", steps);
                }} />
                <Input className="col-span-3" placeholder="Target" value={step.target ?? ""} onChange={(e) => {
                  const steps = [...value.steps];
                  steps[idx] = { ...steps[idx], target: e.target.value || undefined };
                  update("steps", steps);
                }} />
              </>
            ) : (
              <div className="col-span-6 text-xs text-muted-foreground">{step.type === "rest" ? "Rest step: no exercise/target" : "Transition step"}</div>
            )}
            <Input className="col-span-3" type="number" placeholder="Sec" value={step.durationSeconds ?? ""} onChange={(e) => {
              const steps = [...value.steps];
              const base = { ...steps[idx], durationSeconds: e.target.value ? Number(e.target.value) : undefined };
              steps[idx] = base.type === "work" ? base : { ...base, exercise: undefined, target: undefined };
              update("steps", steps);
            }} />
            <div className="col-span-2 flex gap-1 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => reorderStep(idx, -1)} disabled={idx === 0}>↑</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => reorderStep(idx, 1)} disabled={idx === value.steps.length - 1}>↓</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => update("steps", value.steps.filter((_, i) => i !== idx))}>×</Button>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">+ Add Block</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={addWorkStep}>Work step</DropdownMenuItem>
              <DropdownMenuItem disabled>EMOM is block-only</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {Object.entries(workoutStructureFeatureFlags).map(([k, enabled]) => (
          <span key={k} className={`rounded border px-2 py-0.5 ${enabled ? "border-primary text-primary" : ""}`}>{k}: {enabled ? "on" : "off"}</span>
        ))}
      </div>
    </div>
  );
}
