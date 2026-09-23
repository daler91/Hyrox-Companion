import { Loader2 } from "lucide-react";

import { AiConsentDetails } from "@/components/coach/AiConsentDetails";
import { Button } from "@/components/ui/button";

interface GeneratePlanConsentStepProps {
  readonly onEnable: () => void;
  readonly onCancel: () => void;
  readonly isEnabling: boolean;
}

/**
 * Shown in place of the generator's three steps while the AI Coach is off.
 * The server refuses to generate without that consent, so the choice comes
 * first rather than after the athlete has filled in every step.
 */
export function GeneratePlanConsentStep({
  onEnable,
  onCancel,
  isEnabling,
}: GeneratePlanConsentStepProps) {
  return (
    <div className="space-y-4">
      <AiConsentDetails />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isEnabling}>
          Not now
        </Button>
        <Button onClick={onEnable} disabled={isEnabling} data-testid="button-generate-enable-ai">
          {isEnabling && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Enable AI Coach
        </Button>
      </div>
    </div>
  );
}
