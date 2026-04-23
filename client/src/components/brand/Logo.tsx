import { NexusMark } from "./NexusMark";
import { Wordmark } from "./Wordmark";

export function Logo({
  size = 32,
  showWordmark = true,
  className = "",
  variant = "primary",
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
  variant?: "primary" | "ink" | "mono" | "currentColor";
}) {
  if (!showWordmark) {
    return <NexusMark size={size} variant={variant} className={className} />;
  }

  return (
    <div className={`flex items-center gap-[14px] ${className}`}>
      <NexusMark size={size} variant={variant} />
      <Wordmark size={size <= 24 ? "sm" : size >= 40 ? "lg" : "md"} />
    </div>
  );
}
