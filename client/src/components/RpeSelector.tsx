import { Gauge } from "lucide-react";
import { Label } from "@/components/ui/label";

function getRpeLabel(rpe: number): string {
  if (rpe <= 3) return "Easy";
  if (rpe <= 6) return "Moderate";
  if (rpe <= 8) return "Hard";
  return "Max Effort";
}

function getRpeColor(value: number): string {
  if (value <= 3) return "bg-green-500 text-white";
  if (value <= 6) return "bg-yellow-500 text-white";
  if (value <= 8) return "bg-orange-500 text-white";
  return "bg-red-500 text-white";
}

interface RpeSelectorProps {
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly showLabel?: boolean;
  readonly compact?: boolean;
}

export function RpeSelector({ value, onChange, showLabel = true, compact = false }: RpeSelectorProps) {
  const buttonSize = compact ? "h-7 w-7 text-xs" : "h-8 w-8 text-sm";

  return (
    <div className="space-y-2">
      {showLabel && (
        <Label className="flex items-center gap-1">
          <Gauge className="h-3.5 w-3.5" />
          RPE (Rate of Perceived Exertion)
        </Label>
      )}
      <div className="flex items-center gap-1.5" data-testid="input-rpe-selector">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((rpeValue) => (
          <button
            key={rpeValue}
            type="button"
            onClick={() => onChange(value === rpeValue ? null : rpeValue)}
            className={`${buttonSize} rounded-md font-medium transition-colors ${
              value === rpeValue
                ? getRpeColor(rpeValue)
                : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
            data-testid={`button-rpe-${rpeValue}`}
          >
            {rpeValue}
          </button>
        ))}
        {value && (
          <span className="ml-2 text-xs text-muted-foreground" data-testid="text-rpe-label">
            {getRpeLabel(value)}
          </span>
        )}
      </div>
    </div>
  );
}
