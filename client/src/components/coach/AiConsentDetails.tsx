import { ExternalLink, ShieldCheck } from "lucide-react";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * What turning the AI Coach on sends, and to whom. Shared by every place that
 * asks for that consent (the coach's consent dialog, the AI plan generator and
 * the onboarding coach step) so the disclosure reads the same wherever the
 * athlete meets it. Extra props land on the root, so it can be a Radix
 * `Description` via `asChild`.
 */
export function AiConsentDetails({ className, ...props }: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={cn("space-y-3 text-sm text-muted-foreground", className)} {...props}>
      <p>
        The AI Coach uses the configured AI provider to analyze your training and provide
        personalized coaching. To do this, the following data is sent for processing:
      </p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Your recent workout history (exercises, sets, reps, weights)</li>
        <li>Training plan details and schedule</li>
        <li>Performance metrics (RPE, duration, heart rate if synced)</li>
        <li>Chat messages you send to the coach</li>
        <li>Meal descriptions and photos you submit for AI food logging</li>
      </ul>
      <div className="flex items-start gap-2 rounded-md bg-muted p-3">
        <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <p className="text-xs">
          Your data is used solely by this app to generate coaching responses. You can disable the
          AI Coach at any time in Settings.
        </p>
      </div>
      <p className="text-xs">
        By enabling, you consent to this data processing.{" "}
        <a
          href="/privacy"
          className="inline-flex items-center gap-1 rounded underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Privacy Policy <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
