type WordmarkSize = "sm" | "md" | "lg";

type WordmarkProps = Readonly<{
  className?: string;
  size?: WordmarkSize;
}>;

const SIZE_CLASS: Record<WordmarkSize, string> = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-2xl",
};

export function Wordmark({ className = "", size = "md" }: WordmarkProps) {
  return (
    <span
      className={`font-heading font-bold tracking-tight leading-none ${SIZE_CLASS[size]} ${className}`}
      style={{ letterSpacing: "-0.025em" }}
    >
      <span className="text-foreground">fitai</span>
      <span className="text-muted-foreground">.coach</span>
    </span>
  );
}
