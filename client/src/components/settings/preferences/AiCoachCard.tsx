import { BrainCircuit } from "lucide-react";

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
        <CardDescription>Intelligent workout adjustments powered by the configured AI provider</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PreferenceSwitchRow
          id="ai-coach-enabled-switch"
          label={<span className="flex items-center gap-2">Auto-Adjust Workouts</span>}
          description="After each completed workout, the AI coach analyses your performance and automatically adjusts upcoming sessions to keep you on track for your plan goal."
          checked={aiCoachEnabled}
          onCheckedChange={onAiCoachEnabledChange}
          testId="switch-ai-coach-enabled"
        />
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
