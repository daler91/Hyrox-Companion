import { NexusMark } from "./NexusMark";
import { Wordmark } from "./Wordmark";

type LogoProps = Readonly<{
  size?: number;
  showWordmark?: boolean;
  className?: string;
  variant?: "primary" | "ink" | "mono" | "currentColor";
}>;

function wordmarkSizeForMark(size: number): "sm" | "md" | "lg" {
  if (size <= 24) return "sm";
  if (size >= 40) return "lg";
  return "md";
}

export function Logo({
  size = 32,
  showWordmark = true,
  className = "",
  variant = "primary",
}: LogoProps) {
  if (!showWordmark) {
    return <NexusMark size={size} variant={variant} className={className} />;
  }

  return (
    <div className={`flex items-center gap-[14px] ${className}`}>
      <NexusMark size={size} variant={variant} />
      <Wordmark size={wordmarkSizeForMark(size)} />
    </div>
  );
}
