import {
  Activity,
  Apple,
  BarChart3,
  Bell,
  BookOpen,
  Brain,
  Calendar,
  CalendarCheck,
  Camera,
  CheckCircle2,
  Flame,
  Gauge,
  HeartPulse,
  type LucideIcon,
  Mic,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Undo2,
  Wand2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { featureFlags } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";

import { SectionHeading } from "./SectionHeading";

const SOCIAL_PROOF: string[] = [
  "200+ Exercises",
  "Strava & Garmin Sync",
  "AI-Powered Coaching",
  "Session Grading",
  "Missed-Session Recovery",
  "Voice & Photo Logging",
  ...(featureFlags.nutritionEnabled ? ["Nutrition & Macros"] : []),
];

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
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              <span className="text-sm font-medium tabular-nums">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
  highlightIcon: LucideIcon;
  highlight: string;
  isNew?: boolean;
}

const NUTRITION_FEATURE: Feature = {
  icon: Apple,
  title: "Nutrition & Fuelling",
  description:
    "Log meals by describing them, snapping a photo, or scanning a barcode — AI breaks down calories and macros. Set training-aware targets that scale your carbs to each day's load.",
  highlightIcon: Flame,
  highlight: "AI macro tracking",
};

const FEATURES: Feature[] = [
  {
    icon: Brain,
    title: "AI Auto-Coach",
    description:
      "Log a workout and your plan moves with you: loads rise when a session feels easy, hold after a grind, deload after repeated misses, and run paces step up after a new best — each change noting which session caused it.",
    highlightIcon: Sparkles,
    highlight: "Adapts your plan after every session",
  },
  {
    icon: Wand2,
    title: "Plans Built From Your Numbers",
    description:
      "Generate a plan whose loads come from your estimated 1RMs, run paces from your best recent run, and exercises from your own training history — or import a CSV or start from an 8-week template.",
    highlightIcon: Target,
    highlight: "Computed, not guessed",
  },
  {
    icon: Gauge,
    title: "Session Grading",
    description:
      "Did the session do its job? Easy and threshold runs are graded against their plan day from your Strava heart-rate and pace data — stayed easy, crept up, held threshold, or drifted harder.",
    highlightIcon: HeartPulse,
    highlight: "Graded from your HR & pace",
    isNew: true,
  },
  {
    icon: CalendarCheck,
    title: "Missed-Session Recovery",
    description:
      "A missed session is a decision, not a red square. Fold it into another day, shorten it, or let it go — and see what each option does to your week before you pick. Key sessions are protected first.",
    highlightIcon: Undo2,
    highlight: "Every choice can be undone",
    isNew: true,
  },
  {
    icon: Activity,
    title: "Load by Body System",
    description:
      "One training-load number hides where the load landed. See aerobic, running impact, leg muscle, and upper-body pull load against your usual week — and your AI coach sees the same split.",
    highlightIcon: TrendingUp,
    highlight: "Spot overload before it bites",
    isNew: true,
  },
  {
    icon: Calendar,
    title: "Training Timeline",
    description:
      "See your whole training journey in one view. Every session is tagged key, supporting, or optional, and annotations capture injury, illness, or travel so gaps have context.",
    highlightIcon: Calendar,
    highlight: "Past, present, and future",
  },
  {
    icon: Mic,
    title: "Voice & Photo Logging",
    description:
      "Log a session by typing, dictating, or snapping a photo of a whiteboard or printed plan. AI structures it into exercises, sets, reps, and loads for you to review.",
    highlightIcon: Camera,
    highlight: "Text, voice, or photo",
  },
  {
    icon: RefreshCw,
    title: "Strava & Garmin Sync",
    description:
      "Completed activities import automatically, and Strava activities are matched to the day's planned session. Heart rate, pace, and power flow in — with an RPE suggested from your heart rate when you skip it.",
    highlightIcon: Activity,
    highlight: "Auto-sync your activities",
  },
  {
    icon: BarChart3,
    title: "Analytics & PRs",
    description:
      "Track completion rates, streaks, and personal records across every exercise, plus a HYROX race-time predictor and session grades rolled up by week and training block.",
    highlightIcon: TrendingUp,
    highlight: "Data-driven improvement",
  },
  {
    icon: Bell,
    title: "Weekly Review & Briefs",
    description:
      "Look back on each week in the Weekly Review, and opt in to daily session briefs, weekly summaries, and missed-day reminders by email or push — sent at the hour you choose.",
    highlightIcon: Bell,
    highlight: "Stay on track, your way",
  },
  ...(featureFlags.nutritionEnabled ? [NUTRITION_FEATURE] : []),
  {
    icon: BookOpen,
    title: "Your Coaching Playbook",
    description:
      "Upload your own coaching principles and documents. Your AI coach reads them and grounds its advice in your methodology — not generic templates.",
    highlightIcon: BookOpen,
    highlight: "RAG-powered coaching",
  },
];

function FeatureCard({ feature, wide }: Readonly<{ feature: Feature; wide: boolean }>) {
  const { icon: Icon, highlightIcon: HighlightIcon } = feature;
  return (
    <Card
      className={cn(
        "fade-up hover-elevate group relative border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.18)]",
        wide && "md:col-span-2",
      )}
    >
      <CardContent className="p-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent/15 ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/25 transition-colors">
          <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h3 className="font-heading font-semibold text-lg mb-2 flex flex-wrap items-center gap-2">
            {feature.title}
            {feature.isNew ? (
              <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary border-0">
                New
              </Badge>
            ) : null}
          </h3>
          <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
          <div className="mt-3 flex items-center gap-1.5 text-primary text-sm font-medium">
            <HighlightIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {feature.highlight}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Features() {
  // Stretch a lone last card across both columns so the grid never ends with a gap.
  const hasOrphan = FEATURES.length % 2 === 1;
  return (
    <section id="features" className="py-20 md:py-28">
      <div className="container mx-auto px-4">
        <SectionHeading
          eyebrow="Features"
          title="Everything You Need to Train Smarter"
          description="From plans built on your own numbers to sessions graded against their purpose, every tool adapts to your training."
        />
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {FEATURES.map((feature, index) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              wide={hasOrphan && index === FEATURES.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
