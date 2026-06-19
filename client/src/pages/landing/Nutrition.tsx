import { BarChart3, Camera, Flame, Sparkles, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { SectionHeading } from "./SectionHeading";

function MacroBar({ label, value, target, unit, width }: { label: string; value: number; target: number; unit: string; width: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {value}<span className="text-muted-foreground/60">/{target}{unit}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width }} />
      </div>
    </div>
  );
}

function NutritionMockup() {
  return (
    <div
      className="w-full max-w-md mx-auto"
      role="img"
      aria-label="Preview of the nutrition day view showing calories and macros logged against training-aware targets, with an AI-parsed meal"
    >
      <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-[0_24px_60px_-15px_rgba(0,0,0,0.25)] ring-1 ring-accent/20 overflow-hidden" aria-hidden="true">
        <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400/60" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
          <div className="w-3 h-3 rounded-full bg-green-400/60" />
          <span className="ml-2 text-xs text-muted-foreground font-mono">Today · Fuelling</span>
        </div>
        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">Calories</span>
              <span className="text-sm tabular-nums font-medium">
                2,150<span className="text-muted-foreground"> / 2,400 kcal</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary w-[90%]" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <MacroBar label="Protein" value={140} target={180} unit="g" width="78%" />
            <MacroBar label="Carbs" value={210} target={260} unit="g" width="81%" />
            <MacroBar label="Fat" value={60} target={70} unit="g" width="86%" />
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <Sparkles className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-xs text-muted-foreground">Carbs scaled up for today&apos;s high training load</span>
          </div>

          <div className="rounded-lg border border-border/40 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Breakfast</span>
              <Badge className="text-[10px] px-1.5 py-0 bg-accent/20 text-accent-foreground border-0 ml-auto">
                <Sparkles className="h-2.5 w-2.5 mr-0.5" /> AI parsed
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">Oats, banana &amp; a scoop of whey · 540 kcal</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const HIGHLIGHTS = [
  {
    icon: Camera,
    title: "Log meals in seconds",
    body: "Describe a meal, snap a photo, or scan a barcode — AI parses it into foods and portions for you to confirm.",
  },
  {
    icon: BarChart3,
    title: "Macros & micronutrients",
    body: "Track calories, protein, carbs, fat, and fiber against daily totals — plus a breakdown of key micronutrients.",
  },
  {
    icon: Target,
    title: "Training-aware targets",
    body: "Set targets manually or calculate them from your profile. Carbs scale with each day's training load.",
  },
  {
    icon: Sparkles,
    title: "AI nutrition insights",
    body: "Get on-demand coaching that reads your recent intake against your training and targets, then tells you what to adjust.",
  },
] as const;

export function NutritionShowcase() {
  return (
    <section className="py-20 md:py-28 bg-muted/30">
      <div className="container mx-auto px-4">
        <SectionHeading
          eyebrow="Nutrition"
          eyebrowIcon={Flame}
          title="Fuel Every Session"
          description="Log what you eat in seconds and keep your fuelling matched to your training — not a generic calorie goal."
        />
        <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
          <div className="fade-up">
            <NutritionMockup />
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {HIGHLIGHTS.map((item) => (
              <div key={item.title} className="fade-up flex gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent/15 ring-1 ring-primary/15">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold mb-1">{item.title}</h3>
                  <p className="text-muted-foreground text-sm">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
