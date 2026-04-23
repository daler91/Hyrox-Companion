export function Wordmark({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass =
    size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  return (
    <span
      className={`font-heading font-bold tracking-tight leading-none ${sizeClass} ${className}`}
      style={{ letterSpacing: "-0.025em" }}
    >
      <span className="text-foreground">fitai</span>
      <span className="text-muted-foreground">.coach</span>
    </span>
  );
}
