import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Gauge, X } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function getRpeLabel(rpe: number): string {
  if (rpe <= 3) return "Easy";
  if (rpe <= 6) return "Moderate";
  if (rpe <= 8) return "Hard";
  return "Max Effort";
}

function getRpeColor(value: number): string {
  // Foregrounds meet WCAG 1.4.3 (>=4.5:1) on each fill: white on the darker
  // green/orange/red, dark text on the light yellow (white-on-yellow/orange was
  // ~1.9:1/2.9:1). Effort is also conveyed by the always-visible number and the
  // text label below, so color is not the sole cue (1.4.1).
  if (value <= 3) return "bg-green-700 text-white";
  if (value <= 6) return "bg-yellow-400 text-black";
  if (value <= 8) return "bg-orange-700 text-white";
  return "bg-red-600 text-white";
}

interface RpeSelectorProps {
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly showLabel?: boolean;
  readonly compact?: boolean;
}

export function RpeSelector({ value, onChange, showLabel = true, compact = false }: Readonly<RpeSelectorProps>) {
  // Default mode meets the 44x44 touch-target recommendation (h-11 w-11); the
  // row uses flex-wrap so the ten buttons wrap on narrow screens rather than
  // overflow. Compact mode (28x28) stays below it by design for dense layouts
  // where the parent decides density; arrow-key navigation (via Radix
  // RadioGroup) keeps it keyboard-friendly there (S9).
  const buttonSize = compact ? "h-7 w-7 text-xs" : "h-11 w-11 text-sm";

  return (
    <fieldset className="space-y-2 border-0 m-0 p-0">
      {showLabel && (
        <legend className="flex items-center gap-1 text-sm font-medium">
          <Gauge className="h-3.5 w-3.5" />
          RPE (Rate of Perceived Exertion)
        </legend>
      )}
      {!showLabel && <legend className="sr-only">RPE selector</legend>}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="input-rpe-selector">
        {/* Radix RadioGroup gives us arrow-key navigation, single-select
            semantics, and aria-checked announcements out of the box.
            Empty-string value when none selected (Radix expects string). */}
        <RadioGroupPrimitive.Root
          className="flex flex-wrap items-center gap-1.5"
          value={value === null ? "" : String(value)}
          onValueChange={(next) => onChange(Number(next))}
          aria-label="RPE 1 through 10"
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((rpeValue) => {
            const isSelected = value === rpeValue;
            return (
              <RadioGroupPrimitive.Item
                key={rpeValue}
                value={String(rpeValue)}
                aria-label={`RPE ${rpeValue}, ${getRpeLabel(rpeValue)}`}
                className={`${buttonSize} rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                  isSelected
                    ? getRpeColor(rpeValue)
                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                }`}
                data-testid={`button-rpe-${rpeValue}`}
              >
                {rpeValue}
              </RadioGroupPrimitive.Item>
            );
          })}
        </RadioGroupPrimitive.Root>
        {value !== null && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  aria-label="Clear RPE selection"
                  className={`${buttonSize} rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`}
                  data-testid="button-rpe-clear"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Clear RPE selection</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {value && (
        <span className="text-xs text-muted-foreground" data-testid="text-rpe-label">
          {getRpeLabel(value)}
        </span>
      )}
    </fieldset>
  );
}
