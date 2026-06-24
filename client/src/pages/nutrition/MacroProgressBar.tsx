interface MacroProgressBarProps {
  readonly pct: number;
  readonly label?: string;
  readonly value?: number;
  readonly target?: number;
}

export function MacroProgressBar({ pct, label, value, target }: MacroProgressBarProps) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const overTarget = pct > 100;

  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      aria-valuetext={
        value != null && target != null
          ? `${Math.round(value)} of ${Math.round(target)}${overTarget ? ", over target" : ""}`
          : undefined
      }
    >
      <div
        className={`h-full ${overTarget ? "bg-amber-500" : "bg-primary"}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
