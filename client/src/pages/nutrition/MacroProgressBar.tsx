import { cn } from "@/lib/utils";

interface MacroProgressBarProps {
  readonly pct: number;
  readonly label?: string;
  readonly value?: number;
  readonly target?: number;
}

export function MacroProgressBar({ pct, label, value, target }: MacroProgressBarProps) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const overTarget = pct > 100;
  const overTargetSuffix = overTarget ? ", over target" : "";
  const ariaValueText =
    value != null && target != null
      ? `${Math.round(value)} of ${Math.round(target)}${overTargetSuffix}`
      : undefined;
  const fillClass = overTarget
    ? "[&::-webkit-progress-value]:bg-amber-500 [&::-moz-progress-bar]:bg-amber-500"
    : "[&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary";

  return (
    <progress
      className={cn(
        "h-1 w-full appearance-none overflow-hidden rounded-full bg-muted",
        "[&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:rounded-full",
        fillClass,
      )}
      value={clamped}
      max={100}
      aria-label={label}
      aria-valuetext={ariaValueText}
    />
  );
}
