import { Card, CardContent } from "@/components/ui/card";
import { Activity, BarChart3, Brain, Calendar, CheckCircle2, Sparkles, TrendingUp } from "lucide-react";
import { SiStrava } from "react-icons/si";

export function SocialProof() {
  return (
    <section className="py-12 border-y bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-sm font-medium">40+ Exercises</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-sm font-medium">Strava Sync</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-sm font-medium">AI-Powered Coaching</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-sm font-medium">Personal Records</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section id="features" className="py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <h2 className="fade-up text-3xl md:text-4xl font-bold mb-4">
            Everything You Need to Train Smarter
          </h2>
          <p className="fade-up text-lg text-muted-foreground max-w-2xl mx-auto">
            From structured training plans to real-time AI coaching, every tool adapts to your fitness goals.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          <Card className="fade-up hover-elevate group relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-2">AI Auto-Coach</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Log a workout and watch the magic happen. Your AI coach analyzes your performance and automatically adjusts upcoming sessions to keep you progressing.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
                    <Sparkles className="h-3.5 w-3.5" />
                    Adapts your plan in real-time
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up hover-elevate group relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-2">Training Timeline</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    See your entire training journey in one view. Import CSV plans, schedule them, and track every session with a clean, chronological timeline.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
                    <Calendar className="h-3.5 w-3.5" />
                    Past, present, and future
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up hover-elevate group relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-orange-500/20 transition-colors">
                  <SiStrava className="h-6 w-6 text-orange-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-2">Strava Integration</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Connect your Strava account and automatically import activities. Heart rate, power, cadence, and effort data flow in seamlessly.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-orange-500 text-sm font-medium">
                    <Activity className="h-3.5 w-3.5" />
                    Auto-sync your activities
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="fade-up hover-elevate group relative overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-2">Analytics & PRs</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Track completion rates, training streaks, and personal records across all exercises. See your progress visualized over time.
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Data-driven improvement
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
