import { AlertTriangle, Loader2 } from "lucide-react";

interface ParseStatusStripProps {
  readonly parsing: boolean;
  readonly error?: boolean;
  readonly hasText?: boolean;
  readonly "data-testid"?: string;
}

export function ParseStatusStrip({
  parsing,
  error = false,
  hasText = false,
  "data-testid": testId,
}: ParseStatusStripProps) {
  if (parsing) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary"
        role="status"
        aria-live="polite"
        data-testid={testId ?? "parse-status-parsing"}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Parsing your description into exercises…
      </div>
    );
  }
  if (error && hasText) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        role="status"
        aria-live="polite"
        data-testid="composer-parse-error"
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        Couldn't auto-parse. Keep typing or add exercises manually below.
      </div>
    );
  }
  return null;
}
