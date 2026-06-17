import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  MACRO_TARGET_FIELDS,
  type MacroTargetFieldKey,
  parseTargetInput,
  targetInputValue,
  type TargetLike,
} from "./utils";

type MacroTargetValues = Record<MacroTargetFieldKey, string>;
type MacroTargetParsed = Record<MacroTargetFieldKey, number | null>;

/**
 * Shared form state for the macro/calorie target editors (daily + per-meal):
 * string-backed inputs seeded from an initial target, their parsed numeric form,
 * and a `valid` flag (at least one field set). Keeps the two dialogs DRY.
 */
export function useMacroTargetForm(initial: TargetLike | null) {
  const [values, setValues] = useState<MacroTargetValues>(() => ({
    calories: targetInputValue(initial?.calories),
    proteinG: targetInputValue(initial?.proteinG),
    carbG: targetInputValue(initial?.carbG),
    fatG: targetInputValue(initial?.fatG),
  }));
  const parsed: MacroTargetParsed = {
    calories: parseTargetInput(values.calories),
    proteinG: parseTargetInput(values.proteinG),
    carbG: parseTargetInput(values.carbG),
    fatG: parseTargetInput(values.fatG),
  };
  const valid = Object.values(parsed).some((v) => v != null);
  const setField = (key: MacroTargetFieldKey, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  return { values, setValues, setField, parsed, valid };
}

/** The four macro/calorie number inputs shared by the target editors. `idPrefix`
 *  namespaces the field + test ids (e.g. "target" → input-target-calories). */
export function MacroTargetInputs({
  values,
  onChange,
  idPrefix,
}: {
  readonly values: MacroTargetValues;
  readonly onChange: (key: MacroTargetFieldKey, value: string) => void;
  readonly idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {MACRO_TARGET_FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`${idPrefix}-${f.key}`} className="text-xs">
            {f.label}
          </Label>
          <Input
            id={`${idPrefix}-${f.key}`}
            type="number"
            min={0}
            inputMode="decimal"
            value={values[f.key]}
            onChange={(e) => onChange(f.key, e.target.value)}
            data-testid={`input-${idPrefix}-${f.key}`}
          />
        </div>
      ))}
    </div>
  );
}
