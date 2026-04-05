import { Calendar, ChevronRight, Dumbbell, Sparkles } from "lucide-react";

export function HowItWorks() {
  return (
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
              Upload a CSV training plan or use our built-in fitness templates. Set a start date and your timeline is ready.
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
              Your AI coach analyzes your data, identifies weak spots, and automatically modifies upcoming workouts to keep you progressing.
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
  );
}
