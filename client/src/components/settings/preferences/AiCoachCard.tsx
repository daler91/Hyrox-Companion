import { BrainCircuit } from "lucide-react";

import { AiConsentDetails } from "@/components/coach/AiConsentDetails";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PreferenceSwitchRow } from "./PreferenceRows";

interface AiCoachCardProps {
  readonly aiCoachEnabled: boolean;
  readonly onAiCoachEnabledChange: (checked: boolean) => void;
  readonly coachAutoApplyPlanChanges: boolean;
  readonly onCoachAutoApplyPlanChangesChange: (checked: boolean) => void;
}

export function AiCoachCard({
  aiCoachEnabled,
  onAiCoachEnabledChange,
  coachAutoApplyPlanChanges,
  onCoachAutoApplyPlanChangesChange,
}: AiCoachCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-primary" />
          AI Coach
        </CardTitle>
        <CardDescription>Coaching powered by the configured AI provider, off until you turn it on</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* This switch is aiCoachEnabled, the server's one consent gate for every
            AI call, so it is labelled and disclosed as that consent rather than
            as the auto-adjust feature it also covers; the details below are the
            onboarding coach step's. P2 (CODEBASE_ANALYSIS_2026-10-03) */}
        <PreferenceSwitchRow
          id="ai-coach-enabled-switch"
          label={<span className="flex items-center gap-2">AI Coach and AI data processing</span>}
          description="Lets the app send your training data to the AI provider. Turns on coach chat, AI-built plans and plan adjustments (including automatic adjustments after each workout), workout and meal parsing from text and photos, and Coach Insights. Turning it off stops all of them."
          checked={aiCoachEnabled}
          onCheckedChange={onAiCoachEnabledChange}
          testId="switch-ai-coach-enabled"
        />
        {aiCoachEnabled && <AiConsentDetails data-testid="settings-ai-consent-details" />}
        <PreferenceSwitchRow
          id="coach-auto-apply-plan-changes-switch"
          label={<span className="flex items-center gap-2">Auto-Apply Chat Plan Changes</span>}
          description="When you ask the coach to change your plan in chat, apply the changes immediately instead of showing a preview you confirm. Requires the AI coach to be enabled."
          checked={coachAutoApplyPlanChanges}
          onCheckedChange={onCoachAutoApplyPlanChangesChange}
          testId="switch-coach-auto-apply-plan-changes"
        />
      </CardContent>
    </Card>
  );
}
