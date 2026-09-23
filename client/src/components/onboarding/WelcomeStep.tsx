import { Dumbbell, Target, Trophy } from "lucide-react";

// Says how long setup takes and what it leads to, and gives the privacy
// notice before any health data is asked for: the banner hides while a modal
// is open, so athletes gave weight, age and MAF health answers before seeing
// it (onboarding audit L3, M5). The policy opens in a new tab so the wizard
// keeps its place.
export function WelcomeStep() {
  return (
    <div className="text-center space-y-4">
      <div className="flex justify-center gap-3" aria-hidden="true">
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
      <p className="text-sm" data-testid="text-onboarding-time-estimate">
        Takes about 2 minutes: your units, goal and AI Coach choice, then a training plan on your
        calendar.
      </p>
      <p className="text-xs text-muted-foreground" data-testid="text-onboarding-privacy">
        We use Sentry for error tracking (PII scrubbed). AI coaching, Strava and Garmin stay off
        until you turn them on.{" "}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Read our privacy policy
        </a>
        .
      </p>
    </div>
  );
}
