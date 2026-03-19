import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Calendar,
  MessageSquare,
  TrendingUp,
  Dumbbell,
  Target,
  Zap,
  CheckCircle2,
  ArrowRight,
  BarChart3,
  Brain,
  Sparkles,
  Timer,
  ChevronRight,
} from "lucide-react";
import { SiStrava } from "react-icons/si";
import { SignInButton } from "@clerk/clerk-react";

function useInView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-in");
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    const children = el.querySelectorAll(".fade-up");
    children.forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, []);
  return ref;
}

function TimelineMockup() {
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400/60" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
          <div className="w-3 h-3 rounded-full bg-green-400/60" />
          <span className="ml-2 text-xs text-muted-foreground font-mono">Training Timeline</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full bg-primary" />
            <span className="text-xs font-semibold">Today</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">Week 4</Badge>
          </div>

          <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm font-medium">Upper Body Strength</span>
              <Badge className="text-[10px] px-1.5 py-0 bg-success/20 text-success border-0 ml-auto">Completed</Badge>
            </div>
            <p className="text-xs text-muted-foreground pl-6">Sled Push 4x50m, Wall Balls 4x15, Farmers Carry 3x100m</p>
            <div className="flex gap-1.5 pl-6">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                <SiStrava className="h-2.5 w-2.5 mr-0.5" /> Strava
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">RPE 7</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">52 min</Badge>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 mb-1">
            <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
            <span className="text-xs text-muted-foreground">Tomorrow</span>
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent animate-pulse" />
            <div className="relative flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-sm font-medium">Hyrox Simulation</span>
              <Badge className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-0 ml-auto">AI Modified</Badge>
            </div>
            <p className="relative text-xs text-muted-foreground pl-6">8x1km run + all stations (AI adjusted based on your progress)</p>
          </div>

          <div className="rounded-lg border border-border/40 p-3">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
              <span className="text-sm font-medium text-muted-foreground">Recovery & Mobility</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto">Planned</Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StationGrid() {
  const stations = [
    { name: "SkiErg", icon: Activity },
    { name: "Sled Push", icon: Dumbbell },
    { name: "Sled Pull", icon: Dumbbell },
    { name: "Burpees", icon: Zap },
    { name: "Rowing", icon: Activity },
    { name: "Farmers Carry", icon: Dumbbell },
    { name: "Lunges", icon: Target },
    { name: "Wall Balls", icon: Target },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 max-w-lg mx-auto">
      {stations.map((station) => (
        <div
          key={station.name}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-border/50 bg-card/50 hover:bg-primary/5 hover:border-primary/30 transition-colors"
        >
          <station.icon className="h-5 w-5 text-primary" />
          <span className="text-[11px] font-medium text-center leading-tight">{station.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function Landing() {
  const sectionRef = useInView();

  return (
    <div className="min-h-screen bg-background" ref={sectionRef}>
      <style>{`
        .fade-up {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.6s ease-out, transform 0.6s ease-out;
        }
        .fade-up.animate-in {
          opacity: 1;
          transform: translateY(0);
        }
        .fade-up:nth-child(2) { transition-delay: 0.1s; }
        .fade-up:nth-child(3) { transition-delay: 0.2s; }
        .fade-up:nth-child(4) { transition-delay: 0.3s; }
        .fade-up:nth-child(5) { transition-delay: 0.4s; }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        .float-animation {
          animation: float 4s ease-in-out infinite;
        }
      `}</style>

      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">H</span>
            </div>
            <span className="font-bold text-lg">HyroxTracker</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Features</a>
            <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">How It Works</a>
            <SignInButton mode="modal">
              <Button data-testid="button-login-header" size="sm">Log In</Button>
            </SignInButton>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden py-20 md:py-28">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/8 via-transparent to-transparent" />
          <div className="container mx-auto px-4 relative">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="text-center lg:text-left">
                <div className="fade-up">
                  <Badge variant="outline" className="mb-4 px-3 py-1 text-xs font-medium">
                    <Sparkles className="h-3 w-3 mr-1.5" />
                    Now with AI Auto-Coaching
                  </Badge>
                </div>
                <h1 className="fade-up text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-5 leading-[1.1]">
                  Your Hyrox
                  <br />
                  <span className="text-primary">Training Partner</span>
                </h1>
                <p className="fade-up text-lg md:text-xl text-muted-foreground mb-8 max-w-lg mx-auto lg:mx-0">
                  Plan, track, and analyze every session. Our AI coach watches your progress and automatically adapts your upcoming workouts.
                </p>
                <div className="fade-up flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                  <SignInButton mode="modal">
                    <Button size="lg" className="text-base px-6" data-testid="button-get-started">
                      Get Started Free
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </SignInButton>
                  <a href="#features">
                    <Button variant="outline" size="lg" className="text-base px-6 w-full sm:w-auto">
                      See Features
                    </Button>
                  </a>
                </div>
              </div>
              <div className="fade-up float-animation hidden lg:block">
                <TimelineMockup />
              </div>
            </div>
          </div>
        </section>

        <section className="py-12 border-y bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-sm font-medium">All 8 Hyrox Stations</span>
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

        <section id="features" className="py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="text-center mb-14">
              <h2 className="fade-up text-3xl md:text-4xl font-bold mb-4">
                Everything You Need for Race Day
              </h2>
              <p className="fade-up text-lg text-muted-foreground max-w-2xl mx-auto">
                From structured training plans to real-time AI coaching, every tool is designed specifically for Hyrox athletes.
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

        <section id="how-it-works" className="py-20 md:py-28 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="text-center mb-14">
              <h2 className="fade-up text-3xl md:text-4xl font-bold mb-4">
                How It Works
              </h2>
              <p className="fade-up text-lg text-muted-foreground max-w-2xl mx-auto">
                Get set up in minutes. Your AI coach takes over from there.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              <div className="fade-up text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 relative">
                  <Calendar className="h-7 w-7 text-primary" />
                  <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">1</span>
                </div>
                <h3 className="font-semibold text-lg mb-2">Import Your Plan</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Upload a CSV training plan or use our built-in 8-week Hyrox template. Set a start date and your timeline is ready.
                </p>
              </div>

              <div className="fade-up text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 relative">
                  <Dumbbell className="h-7 w-7 text-primary" />
                  <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">2</span>
                </div>
                <h3 className="font-semibold text-lg mb-2">Train & Log</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Complete your workouts and log the details — times, weights, RPE, notes. Or let Strava auto-import for you.
                </p>
              </div>

              <div className="fade-up text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 relative">
                  <Sparkles className="h-7 w-7 text-primary" />
                  <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">3</span>
                </div>
                <h3 className="font-semibold text-lg mb-2">AI Adapts</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Your AI coach analyzes your data, identifies weak spots, and automatically modifies upcoming workouts to optimize your prep.
                </p>
              </div>
            </div>

            <div className="hidden md:flex justify-center mt-2">
              <div className="flex items-center gap-0 max-w-2xl w-full px-16 -mt-[7.5rem]">
                <div className="flex-1 border-t-2 border-dashed border-primary/20" />
                <ChevronRight className="h-4 w-4 text-primary/40 -mx-1" />
                <div className="flex-1 border-t-2 border-dashed border-primary/20" />
                <ChevronRight className="h-4 w-4 text-primary/40 -mx-1" />
                <div className="flex-1 border-t-2 border-dashed border-primary/20" />
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 md:py-28">
          <div className="container mx-auto px-4">
            <div className="text-center mb-14">
              <h2 className="fade-up text-3xl md:text-4xl font-bold mb-4">
                Built for All 8 Stations
              </h2>
              <p className="fade-up text-lg text-muted-foreground max-w-2xl mx-auto">
                Track every Hyrox discipline with station-specific exercises, times, and personal records.
              </p>
            </div>
            <div className="fade-up">
              <StationGrid />
            </div>
            <div className="mt-12 grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
              <div className="fade-up flex gap-4">
                <div className="flex-shrink-0">
                  <Target className="h-5 w-5 text-primary mt-0.5" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Gap Analysis</h3>
                  <p className="text-muted-foreground text-sm">
                    Your AI coach identifies which stations you're neglecting and adjusts your plan to address weaknesses.
                  </p>
                </div>
              </div>
              <div className="fade-up flex gap-4">
                <div className="flex-shrink-0">
                  <Timer className="h-5 w-5 text-primary mt-0.5" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Pacing Strategy</h3>
                  <p className="text-muted-foreground text-sm">
                    Get race-day pacing advice based on your training data and target finish time.
                  </p>
                </div>
              </div>
              <div className="fade-up flex gap-4">
                <div className="flex-shrink-0">
                  <TrendingUp className="h-5 w-5 text-primary mt-0.5" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Personal Records</h3>
                  <p className="text-muted-foreground text-sm">
                    Automatically track PRs across every exercise. See gold indicators when you beat your best.
                  </p>
                </div>
              </div>
              <div className="fade-up flex gap-4">
                <div className="flex-shrink-0">
                  <MessageSquare className="h-5 w-5 text-primary mt-0.5" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Chat with Your Coach</h3>
                  <p className="text-muted-foreground text-sm">
                    Ask questions about your training, get exercise tips, or discuss race strategy with an AI that knows your data.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 md:py-28 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-primary/5 via-primary/3 to-transparent" />
          <div className="container mx-auto px-4 relative text-center">
            <div className="max-w-2xl mx-auto">
              <h2 className="fade-up text-3xl md:text-4xl font-bold mb-5">
                Ready to Train Smarter?
              </h2>
              <p className="fade-up text-lg text-muted-foreground mb-8">
                Join athletes who are using AI-powered coaching to prepare for their next Hyrox race. Free to get started.
              </p>
              <div className="fade-up">
                <SignInButton mode="modal">
                  <Button size="lg" className="text-base px-8" data-testid="button-start-training">
                    Start Training Today
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </SignInButton>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-xs">H</span>
              </div>
              <span className="font-semibold text-sm">HyroxTracker</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Train for Hyrox with confidence
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
