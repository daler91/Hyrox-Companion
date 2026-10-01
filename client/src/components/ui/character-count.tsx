import { cn } from "@/lib/utils";

interface CharacterCountProps {
  readonly value: string;
  readonly max: number;
  /** DOM id so the paired input can reference us via `aria-describedby`. */
  readonly id: string;
  readonly className?: string;
}

function countColor(remaining: number, max: number): string {
  if (remaining < 0) return "font-medium text-destructive";
  if (remaining <= Math.max(20, Math.floor(max * 0.1))) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

/**
 * Visible, accessible character counter for length-bounded inputs.
 * Pair with `aria-describedby={id}` on the input so screen reader users
 * hear the remaining-characters hint when the field receives focus, and
 * updates are announced politely as they type near the limit. An input
 * without a native `maxLength` (the coach chat, which counts rather than
 * truncate a paste) can go over: the count then says by how much.
 */
export function CharacterCount({ value, max, id, className }: CharacterCountProps) {
  const length = value.length;
  const remaining = max - length;

  return (
    <p
      id={id}
      aria-live="polite"
      className={cn("text-xs text-right tabular-nums mt-1", countColor(remaining, max), className)}
      data-testid={`character-count-${id}`}
    >
      <span className="sr-only">
        {remaining < 0 ? `${-remaining} characters over the limit. ` : `${remaining} characters remaining. `}
      </span>
      <span aria-hidden="true">{length}/{max}</span>
    </p>
  );
}
