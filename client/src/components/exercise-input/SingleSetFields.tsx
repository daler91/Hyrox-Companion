import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SetData } from "../ExerciseInput";
import type { FieldKey, FieldConfig } from "./types";

interface SingleSetFieldsProps {
  readonly exerciseName: string;
  readonly idPrefix: string;
  readonly fields: FieldKey[];
  readonly fieldConfig: Record<FieldKey, FieldConfig>;
  readonly set: SetData;
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly onSetChange: (idx: number, field: string, value: string) => void;
}

export function SingleSetFields({ exerciseName, idPrefix, fields, fieldConfig, set, weightUnit, distanceUnit, onSetChange }: SingleSetFieldsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {fields.map((field) => {
        const config = fieldConfig[field];
        const Icon = config.icon;
        const inputId = `${idPrefix}-${field}`;
        return (
          <div key={field} className="space-y-2">
            <Label htmlFor={inputId} className="flex items-center gap-1 text-xs text-muted-foreground">
              <Icon className="h-3 w-3" />
              {config.getLabel(weightUnit, distanceUnit)}
            </Label>
            <Input
              id={inputId}
              type="number"
              placeholder="0"
              value={set[field] ?? ""}
              onChange={(e) => onSetChange(0, field, e.target.value)}
              data-testid={`input-${field}-${exerciseName}`}
            />
          </div>
        );
      })}
    </div>
  );
}
