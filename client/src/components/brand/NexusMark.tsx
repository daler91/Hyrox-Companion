type NexusVariant = "primary" | "ink" | "mono" | "currentColor";

const VARIANT_BG: Record<Exclude<NexusVariant, "currentColor">, string> = {
  primary: "hsl(96 85% 74%)",
  ink: "#0a0a0a",
  mono: "#ffffff",
};

const VARIANT_FG: Record<Exclude<NexusVariant, "currentColor">, string> = {
  primary: "#0a0a0a",
  ink: "#ffffff",
  mono: "#0a0a0a",
};

export function NexusMark({
  size = 32,
  className = "",
  variant = "primary",
  title = "fitai.coach",
}: {
  size?: number;
  className?: string;
  variant?: NexusVariant;
  title?: string;
}) {
  if (variant === "currentColor") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 96 96"
        className={className}
        role="img"
        aria-label={title}
      >
        <g stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none">
          <line x1="24" y1="72" x2="72" y2="72" />
          <line x1="24" y1="72" x2="48" y2="26" />
          <line x1="72" y1="72" x2="48" y2="26" />
        </g>
        <circle cx="24" cy="72" r="8" fill="currentColor" />
        <circle cx="72" cy="72" r="8" fill="currentColor" />
        <circle cx="48" cy="26" r="10" fill="currentColor" />
      </svg>
    );
  }

  const bg = VARIANT_BG[variant];
  const fg = VARIANT_FG[variant];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      className={className}
      role="img"
      aria-label={title}
    >
      <rect width="96" height="96" rx="21" fill={bg} />
      <g stroke={fg} strokeWidth="5" strokeLinecap="round">
        <line x1="24" y1="72" x2="72" y2="72" />
        <line x1="24" y1="72" x2="48" y2="26" />
        <line x1="72" y1="72" x2="48" y2="26" />
      </g>
      <circle cx="24" cy="72" r="8" fill={fg} />
      <circle cx="72" cy="72" r="8" fill={fg} />
      <circle cx="48" cy="26" r="10" fill={fg} />
      <circle cx="48" cy="26" r="4" fill={bg} />
    </svg>
  );
}
