import { BrainCircuit } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PreferenceSwitchRow } from "./PreferenceRows";

interface AiCoachCardProps {
  readonly aiCoachEnabled: boolean;
  readonly onAiCoachEnabledChange: (checked: boolean) => void;
}

export function AiCoachCard({ aiCoachEnabled, onAiCoachEnabledChange }: AiCoachCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-primary" />
          AI Coach
        </CardTitle>
        <CardDescription>Intelligent workout adjustments powered by Gemini</CardDescription>
      </CardHeader>
      <CardContent>
        <PreferenceSwitchRow
          id="ai-coach-enabled-switch"
          label={<span className="flex items-center gap-2">Auto-Adjust Workouts</span>}
          description="After each completed workout, the AI coach analyses your performance and automatically adjusts upcoming sessions to keep you on track for your plan goal."
          checked={aiCoachEnabled}
          onCheckedChange={onAiCoachEnabledChange}
          testId="switch-ai-coach-enabled"
        />
      </CardContent>
    </Card>
  );
}
