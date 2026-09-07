import { ExplanationTooltip } from "@/components/ui/explanation-tooltip";

/**
 * The one-line caveat under a set of fuelling targets, with the full
 * per-component breakdown behind its tooltip.
 *
 * Shared by the two panels that show session targets — the logged-workout one
 * and the planned-session one — which had drifted into two copies of the same
 * markup with different test ids.
 */
export function FuellingGuidanceNote({
  explanation,
  testId,
}: {
  readonly explanation: string;
  /** Identifies the paragraph; the tooltip trigger gets `${testId}-explanation`. */
  readonly testId: string;
}) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid={testId}>
      Targets are guidance based on this session.
      <ExplanationTooltip
        subject="Fuelling targets"
        explanation={explanation}
        testId={`${testId}-explanation`}
      />
    </p>
  );
}
