import type { TimelineAnnotationType } from "@shared/schema";

// Shared display metadata for timeline annotations. Colocated so the dialog,
// inline timeline card, and any future surface (chart tooltips, coach
// summaries) all render the same types in the same colors.
export const TYPE_LABELS: Record<TimelineAnnotationType, string> = {
  injury: "Injury",
  illness: "Illness",
  travel: "Travel",
  rest: "Rest block",
};

// Tailwind ramps mirror the ReferenceArea bands used on the Analytics
// training-overview chart so the two surfaces read as the same dataset.
export const TYPE_COLORS: Record<TimelineAnnotationType, string> = {
  injury: "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400",
  illness: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
  travel: "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-400",
  rest: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
};

// Left-border ramps for the inline log cards — the same hue as TYPE_COLORS
// but expressed as a solid border color so the card gets a visible coloured
// stripe on its leading edge.
export const TYPE_BORDER_COLORS: Record<TimelineAnnotationType, string> = {
  injury: "border-l-red-500",
  illness: "border-l-amber-500",
  travel: "border-l-sky-500",
  rest: "border-l-emerald-500",
};
