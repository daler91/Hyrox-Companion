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

/** A target's four fields as form input strings (unset ⇒ empty). */
export function targetInputValues(target: TargetLike | null): MacroTargetValues {
  return {
    calories: targetInputValue(target?.calories),
    proteinG: targetInputValue(target?.proteinG),
    carbG: targetInputValue(target?.carbG),
    fatG: targetInputValue(target?.fatG),
  };
}

/**
 * Shared form state for the macro/calorie target editors (daily + per-meal):
 * string-backed inputs seeded from an initial target, their parsed numeric form,
 * and a `valid` flag (at least one field set). Keeps the two dialogs DRY.
 */
export function useMacroTargetForm(initial: TargetLike | null) {
  const [values, setValues] = useState<MacroTargetValues>(() => targetInputValues(initial));
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
 *  namespaces the field + test ids (e.g. "target" → input-target-calories);
 *  `placeholders` shows what a blank field falls back to, and `lockedKeys`
 *  locks fields whose value is derived rather than typed. A locked field is
 *  read-only, not disabled, and described by `lockedNoteId`, so a screen
 *  reader announces why with the field: a disabled one left the tab order, and
 *  nothing tied the note to it. C21 (CODEBASE_ANALYSIS_2026-10-03) */
export function MacroTargetInputs({
  values,
  onChange,
  idPrefix,
  placeholders,
  lockedKeys,
  lockedNoteId,
}: {
  readonly values: MacroTargetValues;
  readonly onChange: (key: MacroTargetFieldKey, value: string) => void;
  readonly idPrefix: string;
  readonly placeholders?: MacroTargetValues;
  readonly lockedKeys?: readonly MacroTargetFieldKey[];
  readonly lockedNoteId?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {MACRO_TARGET_FIELDS.map((f) => {
        const locked = lockedKeys?.includes(f.key) === true;
        return (
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
              placeholder={placeholders?.[f.key]}
              readOnly={locked}
              aria-describedby={locked ? lockedNoteId : undefined}
              className={locked ? "bg-muted" : undefined}
              onChange={(e) => {
                onChange(f.key, e.target.value);
              }}
              data-testid={`input-${idPrefix}-${f.key}`}
            />
          </div>
        );
      })}
    </div>
  );
}
