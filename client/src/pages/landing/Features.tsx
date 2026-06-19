import { Activity, BarChart3, Brain, Calendar, Camera, CheckCircle2, Mic, RefreshCw, Sparkles, TrendingUp, Wand2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

import { SectionHeading } from "./SectionHeading";

const SOCIAL_PROOF = [
  "200+ Exercises",
  "Strava & Garmin Sync",
  "AI-Powered Coaching",
  "Voice & Photo Logging",
] as const;

export function SocialProof() {
  return (
    <section className="py-12 border-y bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="flex flex-wrap items-center justify-center gap-3">
          {SOCIAL_PROOF.map((label) => (
            <div
              key={label}
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3.5 py-1.5"
            >
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm font-medium tabular-nums">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section id="features" className="py-20 md:py-28">
      <div className="container mx-auto px-4">
        <SectionHeading
          eyebrow="Features"
          title="Everything You Need to Train Smarter"
          description="From structured training plans to real-time AI coaching, every tool adapts to your fitness goals."
        />
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          <Card className="fade-up hover-elevate group relative border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/15 ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/25 transition-colors">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-lg mb-2">AI Auto-Coach</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Log a workout and your AI coach reviews your performance, fatigue signals, and station gaps — then automatically adjusts your upcoming sessions to keep you progressing.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
                    <Sparkles className="h-3.5 w-3.5" />
                    Adapts your plan in real-time
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up hover-elevate group relative border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/15 ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/25 transition-colors">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-lg mb-2">Training Timeline</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    See your whole training journey in one view. Planned, completed, missed, and skipped sessions stay in chronological order — and timeline annotations capture injury, illness, or travel.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
                    <Calendar className="h-3.5 w-3.5" />
                    Past, present, and future
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up hover-elevate group relative border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/15 ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/25 transition-colors">
                  <Mic className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-lg mb-2">Voice &amp; Photo Logging</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Log a session by typing, dictating, or snapping a photo of a whiteboard or printed plan. AI structures it into exercises, sets, reps, and loads for you to review.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
                    <Camera className="h-3.5 w-3.5" />
                    Text, voice, or photo
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up hover-elevate group relative border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/15 ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/25 transition-colors">
                  <RefreshCw className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-lg mb-2">Strava &amp; Garmin Sync</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Connect Strava or Garmin Connect and completed activities import automatically. Heart rate, pace, power, and effort data flow straight to your timeline.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
                    <Activity className="h-3.5 w-3.5" />
                    Auto-sync your activities
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up hover-elevate group relative border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/15 ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/25 transition-colors">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-lg mb-2">Analytics &amp; PRs</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Track completion rates, training streaks, and personal records across every exercise. See your volume, progression, and trends visualized over time.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Data-driven improvement
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up hover-elevate group relative border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/15 ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/25 transition-colors">
                  <Wand2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-lg mb-2">AI Plan Builder</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Generate a personalized plan from your goal and schedule, import a CSV, or start from a built-in 8-week template. Your timeline is ready in minutes.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate, import, or template
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
