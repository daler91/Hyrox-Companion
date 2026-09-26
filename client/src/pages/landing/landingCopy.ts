/**
 * Landing page copy: the feature cards and FAQ entries.
 *
 * Kept apart from the components because copy-paste detection normalizes
 * every string literal to one token, so a list of same-shaped copy entries
 * reads as duplicated code. This file is excluded from duplication only
 * (sonar.cpd.exclusions); it stays fully analyzed otherwise.
 */
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

import { featureFlags } from "@/lib/featureFlags";

export interface Feature {
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

export const FEATURES: Feature[] = [
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

const BASE_FAQS = [
  {
    question: "Is fitai.coach free to use?",
    answer:
      "Yes. The core training tracker, timeline, workout logging, and analytics are free. Some AI-assisted features (plan generation, streaming chat) may have fair-use limits.",
  },
  {
    question: "Do I need a specific race goal?",
    answer:
      "No. fitai.coach works for any structured training: hyrox prep, half-marathon builds, general functional fitness, strength cycles. The exercise library covers running, strength, conditioning, and the full set of functional stations.",
  },
  {
    question: "How does the AI coach work?",
    answer:
      "After each workout you log, the AI reviews your recent volume, intensity, load on each body system, and plan progression, then suggests adjustments to upcoming sessions. You can accept, tweak, or dismiss any suggestion before it touches your plan. Plan numbers aren't guessed: loads come from your estimated 1RMs, run paces from your best recent run, and exercises from your own training history.",
  },
  {
    question: "What happens if I miss a session?",
    answer:
      "You choose what to do with it: fold it into another day, shorten it, or let it go. Each option shows what it does to that day and week — minutes, load, and which key sessions are kept — with a recommendation based on the session's priority. Any choice can be undone, and a session you let go doesn't count against your adherence.",
  },
  {
    question: "How do I know if a run did its job?",
    answer:
      "Easy and threshold runs on your plan are graded from your Strava heart-rate and pace data: easy runs stayed easy, crept up, or went too hard; threshold runs held threshold, drifted harder, or stayed under. Grades show on the workout, in the Weekly Review, and rolled up by week and training block in Analytics.",
  },
  {
    question: "Do I have to type out every workout?",
    answer:
      "No. Describe a session in plain text, dictate it with your voice, or snap a photo of a whiteboard or printed plan. The AI parses it into structured exercises, sets, reps, and loads for you to review before saving.",
  },
  {
    question: "Will my Strava and Garmin activities sync?",
    answer:
      "Yes. Connect Strava or Garmin Connect from Settings and completed activities appear on your timeline with a source badge. Your Strava tokens and Garmin credentials are encrypted at rest and never shared with third parties.",
  },
  {
    question: "What happens if I go offline mid-workout?",
    answer:
      "The app is a Progressive Web App with an offline queue for workout logging. If a workout save loses connection, it is held locally and syncs automatically when you're back online. Signing out or deleting your account clears unsynced local saves for privacy.",
  },
  {
    question: "Can I import my own training plan?",
    answer:
      "Yes. You can upload a CSV training plan during onboarding or from the Timeline page. We also ship an 8-week sample plan and can generate a custom plan from your goal description.",
  },
  {
    question: "Can the AI coach use my own coaching style?",
    answer:
      "Yes. Upload your own coaching principles or documents in Settings and the AI coach indexes them, then grounds its answers and plan adjustments in your methodology instead of relying on generic advice.",
  },
  {
    question: "Can I get reminders and weekly summaries?",
    answer:
      "Yes, if you opt in. Choose daily session briefs, weekly summaries, missed-day reminders, and Sunday weekly-review reminders by email or push, each sent at the local hour you pick. Every email has a one-click unsubscribe.",
  },
  {
    question: "What if I delete something by mistake?",
    answer:
      "Deleted workouts, plan days, and training plans go to a recycle bin for 90 days. Restore them with Undo on the delete message or from the Recycle bin tab in Settings.",
  },
];

const NUTRITION_FAQ = {
  question: "Can I track my nutrition?",
  answer:
    "Yes. Log meals by describing them, snapping a photo, or scanning a barcode, and track calories, macros, and micronutrients. Set training-aware targets that scale your carbs to each day's load — or calculate them from your profile — and get on-demand AI insights on your fuelling.",
};

export const FAQS = [
  ...BASE_FAQS,
  ...(featureFlags.nutritionEnabled ? [NUTRITION_FAQ] : []),
];
