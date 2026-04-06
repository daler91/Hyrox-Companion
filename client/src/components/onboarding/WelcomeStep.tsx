import { Dumbbell, Target, Trophy } from "lucide-react";

export function WelcomeStep() {
  return (
    <div className="text-center space-y-4">
      <div className="flex justify-center gap-3">
        <div className="p-3 rounded-full bg-primary/10">
          <Target className="h-6 w-6 text-primary" />
        </div>
        <div className="p-3 rounded-full bg-primary/10">
          <Dumbbell className="h-6 w-6 text-primary" />
        </div>
        <div className="p-3 rounded-full bg-primary/10">
          <Trophy className="h-6 w-6 text-primary" />
        </div>
      </div>
      <p className="text-muted-foreground">
        fitai.coach helps you train smarter with structured plans,
        workout logging, and AI-powered coaching for any fitness goal.
      </p>
    </div>
  );
}
