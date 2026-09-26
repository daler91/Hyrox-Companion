import { Calendar, ChevronRight, Dumbbell, Sparkles } from "lucide-react";

import { SectionHeading } from "./SectionHeading";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 md:py-28 bg-muted/30">
      <div className="container mx-auto px-4">
        <SectionHeading
          eyebrow="How It Works"
          title="How It Works"
          description="Get set up in minutes. Your AI coach takes over from there."
        />
        <div className="relative max-w-4xl mx-auto">
          {/* Dashed connector centered on the icon row (h-14 circle → center at 1.75rem).
              Lives behind the steps; static so reduced-motion is unaffected. */}
          <div
            className="pointer-events-none absolute left-[16%] right-[16%] top-7 hidden -translate-y-1/2 items-center md:flex"
            aria-hidden="true"
          >
            <div className="flex-1 border-t-2 border-dashed border-primary/20" />
            <ChevronRight className="h-4 w-4 text-primary/40 -mx-1" />
            <div className="flex-1 border-t-2 border-dashed border-primary/20" />
            <ChevronRight className="h-4 w-4 text-primary/40 -mx-1" />
            <div className="flex-1 border-t-2 border-dashed border-primary/20" />
          </div>
          <div className="relative grid md:grid-cols-3 gap-8">
            <div className="fade-up text-center">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 relative">
                <Calendar className="h-7 w-7 text-primary" aria-hidden="true" />
                <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                  1
                </span>
              </div>
              <h3 className="font-heading font-semibold text-lg mb-2">Set Up Your Plan</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Generate an AI plan built from your own lifts, run paces, and goals, import a CSV, or
                start from a built-in 8-week template. Set a start date and your timeline is ready.
              </p>
            </div>

            <div className="fade-up text-center">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 relative">
                <Dumbbell className="h-7 w-7 text-primary" aria-hidden="true" />
                <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                  2
                </span>
              </div>
              <h3 className="font-heading font-semibold text-lg mb-2">Train & Log</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Log workouts by text, voice, or photo — or let Strava and Garmin auto-import them.
                Easy and threshold runs are graded on whether they did their job.
              </p>
            </div>

            <div className="fade-up text-center">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 relative">
                <Sparkles className="h-7 w-7 text-primary" aria-hidden="true" />
                <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                  3
                </span>
              </div>
              <h3 className="font-heading font-semibold text-lg mb-2">AI Adapts</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Loads and paces move with every session, missed sessions get a recovery plan, and
                your coach watches load on every body system to keep you progressing.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
