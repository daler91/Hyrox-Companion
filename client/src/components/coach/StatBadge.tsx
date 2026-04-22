interface StatBadgeProps {
  icon: React.ElementType;
  value: number | string;
  label: string;
  color: string;
  ariaLabel?: string;
}

export function StatBadge({ icon: Icon, value, label, color, ariaLabel }: Readonly<StatBadgeProps>) {
  return (
    <div
      className="flex flex-col items-center p-1 rounded-md bg-muted/50"
      role="group"
      aria-label={ariaLabel ?? `${value} ${label}`}
    >
      <Icon className={`h-3 w-3 ${color}`} aria-hidden="true" />
      <span className="text-sm font-semibold font-mono">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
