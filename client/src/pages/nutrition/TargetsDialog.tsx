import type { NutritionTarget } from "@shared/schema";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetTarget } from "@/hooks/useNutrition";

const FIELDS = [
  { key: "calories", label: "Calories (kcal)" },
  { key: "proteinG", label: "Protein (g)" },
  { key: "carbG", label: "Carbs (g)" },
  { key: "fatG", label: "Fat (g)" },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function numToStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

function TargetsForm({
  current,
  onClose,
}: {
  readonly current: NutritionTarget | null;
  readonly onClose: () => void;
}) {
  const setTarget = useSetTarget();
  const [values, setValues] = useState<Record<FieldKey, string>>(() => ({
    calories: numToStr(current?.calories),
    proteinG: numToStr(current?.proteinG),
    carbG: numToStr(current?.carbG),
    fatG: numToStr(current?.fatG),
  }));

  const parsed = {
    calories: parseNum(values.calories),
    proteinG: parseNum(values.proteinG),
    carbG: parseNum(values.carbG),
    fatG: parseNum(values.fatG),
  };
  const valid = Object.values(parsed).some((v) => v != null);

  const submit = () => {
    if (!valid) return;
    setTarget.mutate(parsed, { onSuccess: onClose });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Set nutrition targets</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Your daily goals. Leave a field blank to skip that goal; changes apply from today.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`target-${f.key}`} className="text-xs">
              {f.label}
            </Label>
            <Input
              id={`target-${f.key}`}
              type="number"
              min={0}
              inputMode="decimal"
              value={values[f.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              data-testid={`input-target-${f.key}`}
            />
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={setTarget.isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!valid || setTarget.isPending} data-testid="button-save-targets">
          Save targets
        </Button>
      </DialogFooter>
    </>
  );
}

/** Editor for the user's macro/calorie targets (FR-5.2). */
export function TargetsDialog({
  open,
  current,
  onClose,
}: {
  readonly open: boolean;
  readonly current: NutritionTarget | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="dialog-targets">
        {open && <TargetsForm key={current?.id ?? "new"} current={current} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
