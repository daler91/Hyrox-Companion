import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface NumberStepperProps {
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
  readonly defaultStep?: number;
  readonly stepOptions?: readonly number[];
  readonly min?: number;
  readonly max?: number;
  readonly placeholder?: string;
  readonly ariaLabel: string;
  readonly testId?: string;
  readonly className?: string;
}

export function NumberStepper({
  value,
  onChange,
  defaultStep,
  stepOptions,
  min = 0,
  max,
  placeholder = "0",
  ariaLabel,
  testId,
  className,
}: NumberStepperProps) {
  const initialStep = defaultStep ?? stepOptions?.[0] ?? 1;
  const [step, setStep] = React.useState<number>(initialStep);
  const clamp = (n: number) => {
    let out = n;
    if (min != null && out < min) out = min;
    if (max != null && out > max) out = max;
    // Round to 2 decimals to avoid float noise (e.g. 2.5 + 2.5).
    return Math.round(out * 100) / 100;
  };

  const decrement = () => {
    const current = value ?? 0;
    onChange(clamp(current - step));
  };

  const increment = () => {
    const current = value ?? 0;
    onChange(clamp(current + step));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") {
      onChange(undefined);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) onChange(parsed);
  };

  const cycleStep = () => {
    if (!stepOptions || stepOptions.length === 0) return;
    const idx = stepOptions.indexOf(step);
    const next = stepOptions[(idx + 1) % stepOptions.length];
    setStep(next);
  };

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div className="flex items-stretch w-full">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={decrement}
          aria-label={`Decrease ${ariaLabel}`}
          className="h-11 w-11 rounded-r-none border-r-0 shrink-0"
          data-testid={testId ? `${testId}-decrement` : undefined}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          type="number"
          inputMode="decimal"
          value={value ?? ""}
          onChange={handleInputChange}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="h-11 flex-1 min-w-0 rounded-none text-center text-base font-semibold tabular-nums"
          data-testid={testId}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={increment}
          aria-label={`Increase ${ariaLabel}`}
          className="h-11 w-11 rounded-l-none border-l-0 shrink-0"
          data-testid={testId ? `${testId}-increment` : undefined}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {stepOptions && stepOptions.length > 1 ? (
        <button
          type="button"
          onClick={cycleStep}
          className="text-[10px] text-muted-foreground hover:text-foreground tabular-nums px-2 py-0.5 rounded-full bg-muted/50"
          aria-label={`Step: ${step}. Tap to change.`}
          data-testid={testId ? `${testId}-step` : undefined}
        >
          ± {step}
        </button>
      ) : (
        <span className="text-[10px] text-muted-foreground tabular-nums">± {step}</span>
      )}
    </div>
  );
}
