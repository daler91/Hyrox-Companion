import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

import type { FieldSelectorProps,FieldSource } from "./types";

export function FieldSelector({
  label,
  entry1Value: _entry1Value,
  entry2Value: _entry2Value,
  source,
  onSourceChange,
  customValue,
  onCustomChange,
  isTextArea = false,
}: Readonly<FieldSelectorProps>) {
  const labelId = label.toLowerCase().replaceAll(/\s+/g, "-");

  return (
    <div className="rounded-md border p-3 space-y-2">
      <Label className="text-sm font-medium">{label}</Label>

      <RadioGroup
        value={source}
        onValueChange={(val) => onSourceChange(val as FieldSource)}
        className="flex flex-wrap gap-4"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="entry1" id={`${labelId}-entry1`} />
          <Label htmlFor={`${labelId}-entry1`} className="font-normal cursor-pointer text-sm">
            Workout 1
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <RadioGroupItem value="entry2" id={`${labelId}-entry2`} />
          <Label htmlFor={`${labelId}-entry2`} className="font-normal cursor-pointer text-sm">
            Workout 2
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <RadioGroupItem value="both" id={`${labelId}-both`} />
          <Label htmlFor={`${labelId}-both`} className="font-normal cursor-pointer text-sm">
            Combine both
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <RadioGroupItem value="custom" id={`${labelId}-custom`} />
          <Label htmlFor={`${labelId}-custom`} className="font-normal cursor-pointer text-sm">
            Custom
          </Label>
        </div>
      </RadioGroup>

      {source === "custom" && (
        <Textarea
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder={`Enter custom ${label.toLowerCase()}...`}
          rows={isTextArea ? 3 : 2}
          className="mt-2"
          data-testid={`input-custom-${labelId}`}
        />
      )}
    </div>
  );
}
