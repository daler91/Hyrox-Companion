import { Activity, Dumbbell, MessageSquare, Target, Timer, TrendingUp, Zap } from "lucide-react";

function CategoryGrid() {
  const categories = [
    { name: "Functional", icon: Zap, examples: "SkiErg, Sled Push, Rowing, Wall Balls" },
    { name: "Running", icon: Activity, examples: "Easy runs, Tempo, Intervals, Long runs" },
    { name: "Strength", icon: Dumbbell, examples: "Squats, Deadlifts, Bench, Pull-ups" },
    { name: "Conditioning", icon: Target, examples: "Burpees, Box Jumps, KB Swings" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
      {categories.map((cat) => (
        <div
          key={cat.name}
          className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border/50 bg-card/50 hover:bg-primary/5 hover:border-primary/30 transition-colors"
        >
          <cat.icon className="h-6 w-6 text-primary" />
          <span className="text-sm font-semibold">{cat.name}</span>
          <span className="text-[10px] text-muted-foreground text-center leading-tight">{cat.examples}</span>
        </div>
      ))}
    </div>
  );
}

export function ExerciseShowcase() {
  return (
    <section className="py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <h2 className="fade-up text-3xl md:text-4xl font-bold mb-4">
            Built for Every Training Style
          </h2>
          <p className="fade-up text-lg text-muted-foreground max-w-2xl mx-auto">
            Track every exercise across functional, running, strength, and conditioning — with times and personal records.
          </p>
        </div>
        <div className="fade-up">
          <CategoryGrid />
        </div>
        <div className="mt-12 grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          <div className="fade-up flex gap-4">
            <div className="flex-shrink-0">
              <Target className="h-5 w-5 text-primary mt-0.5" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Gap Analysis</h3>
              <p className="text-muted-foreground text-sm">
                Your AI coach identifies which exercises you're neglecting and adjusts your plan to address weaknesses.
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
                Get pacing advice based on your training data and performance goals.
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
                Ask questions about your training, get exercise tips, or discuss strategy with an AI that knows your data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
