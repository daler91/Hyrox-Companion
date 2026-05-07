import { Gauge } from "lucide-react";

import { RpeSelector } from "@/components/RpeSelector";

interface RpePromptProps {
  readonly value: number | null;
  readonly onChange: (next: number | null) => void;
}

/**
 * Optional-RPE picker shared by LogSheet and AdhocLogSheet. Both
 * surfaces show the same "How hard? (optional)" label above the
 * compact RpeSelector — this component owns that label so the two
 * paths stay visually identical without copy-pasting the markup.
 *
 * ReviewSurface uses a different label ("Effort") and a server-bound
 * onChange, so it intentionally renders its own block instead.
 */
export function RpePrompt({ value, onChange }: RpePromptProps) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Gauge className="h-3.5 w-3.5" />
        How hard? <span className="normal-case text-muted-foreground/70">(optional)</span>
      </p>
      <RpeSelector value={value} onChange={onChange} showLabel={false} compact />
    </div>
  );
}
