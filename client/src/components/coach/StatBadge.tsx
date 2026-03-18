interface StatBadgeProps {
  icon: React.ElementType;
  value: number | string;
  label: string;
  color: string;
}

export function StatBadge({ icon: Icon, value, label, color }: Readonly<StatBadgeProps>) {
  return (
    <div className="flex flex-col items-center p-1 rounded-md bg-muted/50">
      <Icon className={`h-3 w-3 ${color}`} />
      <span className="text-sm font-semibold font-mono">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
