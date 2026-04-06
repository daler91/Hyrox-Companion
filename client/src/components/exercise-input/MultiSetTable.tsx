import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Minus } from "lucide-react";
import type { SetData } from "../ExerciseInput";
import type { FieldKey, FieldConfig } from "./types";

interface MultiSetTableProps {
  readonly exerciseName: string;
  readonly fields: FieldKey[];
  readonly fieldConfig: Record<FieldKey, FieldConfig>;
  readonly sets: SetData[];
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly onSetChange: (idx: number, field: string, value: string) => void;
  readonly onAddSet: () => void;
  readonly onRemoveSet: (idx: number) => void;
}

export function MultiSetTable({ exerciseName, fields, fieldConfig, sets, weightUnit, distanceUnit, onSetChange, onAddSet, onRemoveSet }: MultiSetTableProps) {
  const colTemplate = `2rem ${fields.map(() => "1fr").join(" ")} 2rem`;

  return (
    <div className="space-y-2">
      <div className="grid gap-2" style={{ gridTemplateColumns: colTemplate }}>
        <div className="text-xs text-muted-foreground font-medium flex items-end pb-1">#</div>
        {fields.map((field) => {
          const config = fieldConfig[field];
          return (
            <div key={field} className="text-xs text-muted-foreground font-medium flex items-end pb-1">
              {config.getLabel(weightUnit, distanceUnit)}
            </div>
          );
        })}
        <div />
      </div>
      {sets.map((set, idx) => (
        <div key={set.setNumber} className="grid gap-2 items-center" style={{ gridTemplateColumns: colTemplate }} data-testid={`set-row-${exerciseName}-${idx}`}>
          <span className="text-xs text-muted-foreground text-center">{set.setNumber}</span>
          {fields.map((field) => (
            <Input
              key={field}
              type="number"
              placeholder="--"
              value={set[field] ?? ""}
              onChange={(e) => onSetChange(idx, field, e.target.value)}
              className="h-8 text-sm"
              data-testid={`input-${field}-${exerciseName}-${idx}`}
              aria-label={`${fieldConfig[field].getLabel(weightUnit, distanceUnit)} for set ${set.setNumber}`}
            />
          ))}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" onClick={() => onRemoveSet(idx)} disabled={sets.length <= 1} className="h-6 w-6" data-testid={`button-remove-set-${idx}`} aria-label={`Remove set ${idx + 1}`}>
                  <Minus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Remove set</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={onAddSet} className="w-full mt-2" data-testid={`button-add-set-${exerciseName}`}>
        <Plus className="h-3 w-3 mr-1" /> Add Set
      </Button>
    </div>
  );
}
