import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, Calendar, MessageSquare, TrendingUp, Dumbbell, Target } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">H</span>
            </div>
            <span className="font-bold text-xl">HyroxTracker</span>
          </div>
          <Button asChild data-testid="button-login-header">
            <a href="/api/login">Log In</a>
          </Button>
        </div>
      </header>

      <main>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4 text-center">
            <div className="max-w-3xl mx-auto">
              <h1 className="text-4xl md:text-5xl font-bold mb-6">
                Train Smarter for Hyrox
              </h1>
              <p className="text-xl text-muted-foreground mb-8">
                Plan, track, and analyze your Hyrox training with an AI coach that knows your performance data.
              </p>
              <Button size="lg" asChild data-testid="button-get-started">
                <a href="/api/login">Get Started Free</a>
              </Button>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/50">
          <div className="container mx-auto px-4">
            <h2 className="text-2xl font-bold text-center mb-12">
              Everything You Need to Prepare for Race Day
            </h2>
            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              <Card>
                <CardContent className="pt-6">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Calendar className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Training Plans</h3>
                  <p className="text-muted-foreground">
                    Import your CSV training plan and schedule it with a start date. Track every session on a unified timeline.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Activity className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Workout Logging</h3>
                  <p className="text-muted-foreground">
                    Log workouts with Hyrox-specific exercises. Track times, RPE, and notes for every session.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <MessageSquare className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">AI Coach</h3>
                  <p className="text-muted-foreground">
                    Chat with an AI that sees your training data. Get personalized advice, identify gaps, and optimize your prep.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl font-bold text-center mb-12">
                Built for Hyrox Athletes
              </h2>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <Dumbbell className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">All 8 Stations</h3>
                    <p className="text-muted-foreground text-sm">
                      Track SkiErg, Sled Push, Sled Pull, Burpees, Rowing, Farmers Carry, Lunges, and Wall Balls.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <TrendingUp className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Progress Tracking</h3>
                    <p className="text-muted-foreground text-sm">
                      See your completion rate, training streak, and workout history at a glance.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <Target className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Gap Analysis</h3>
                    <p className="text-muted-foreground text-sm">
                      AI coach identifies which stations you're neglecting so you can train smarter.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    <Calendar className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">Flexible Scheduling</h3>
                    <p className="text-muted-foreground text-sm">
                      Mark workouts as complete, skip them, or reschedule. Your plan adapts to life.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 bg-muted/50">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-2xl font-bold mb-4">Ready to Train?</h2>
            <p className="text-muted-foreground mb-8">
              Join athletes preparing for their next Hyrox race.
            </p>
            <Button size="lg" asChild data-testid="button-start-training">
              <a href="/api/login">Start Training Today</a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          HyroxTracker - Train for Hyrox with confidence
        </div>
      </footer>
    </div>
  );
}
