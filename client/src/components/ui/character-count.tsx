import { cn } from "@/lib/utils";

interface CharacterCountProps {
  readonly value: string;
  readonly max: number;
  /** DOM id so the paired input can reference us via `aria-describedby`. */
  readonly id: string;
  readonly className?: string;
}

/**
 * Visible, accessible character counter for `maxLength`-bounded inputs.
 * Pair with `aria-describedby={id}` on the input so screen reader users
 * hear the remaining-characters hint when the field receives focus, and
 * updates are announced politely as they type near the limit.
 */
export function CharacterCount({ value, max, id, className }: CharacterCountProps) {
  const length = value.length;
  const remaining = max - length;
  const nearLimit = remaining <= Math.max(20, Math.floor(max * 0.1));

  return (
    <p
      id={id}
      aria-live="polite"
      className={cn(
        "text-xs text-right tabular-nums mt-1",
        nearLimit ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        className,
      )}
      data-testid={`character-count-${id}`}
    >
      <span className="sr-only">{remaining} characters remaining. </span>
      <span aria-hidden="true">{length}/{max}</span>
    </p>
  );
}
