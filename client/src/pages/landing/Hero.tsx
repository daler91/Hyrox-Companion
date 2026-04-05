import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { SiStrava } from "react-icons/si";
import { SignInButton } from "@clerk/react";

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
              <span className="text-sm font-medium">Circuit Simulation</span>
              <Badge className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-0 ml-auto">AI Modified</Badge>
            </div>
            <p className="relative text-xs text-muted-foreground pl-6">Full circuit workout (AI adjusted based on your progress)</p>
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

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">F</span>
          </div>
          <span className="font-bold text-lg">fitai.coach</span>
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
  );
}

export function Hero() {
  return (
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
              Your AI
              <br />
              <span className="text-primary">Fitness Coach</span>
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
  );
}
