import type { LucideIcon } from "lucide-react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface DetailSectionProps {
  readonly title: string;
  readonly icon?: LucideIcon;
  readonly children: ReactNode;
  readonly testId?: string;
  /** Right-aligned header slot, e.g. a save-state pill or count badge. */
  readonly action?: ReactNode;
  /** Render as a native <details> with the header as its <summary>. */
  readonly collapsible?: boolean;
  readonly defaultOpen?: boolean;
  /** "primary" = coach-voice styling (primary-tinted border/background). */
  readonly tone?: "default" | "primary";
  readonly className?: string;
}

const SECTION_CARD = "rounded-xl border shadow-sm";
const TONE_CLASSNAMES: Record<NonNullable<DetailSectionProps["tone"]>, string> = {
  default: "border-card-border bg-card text-card-foreground",
  primary: "border-primary/30 bg-primary/5",
};

function SectionHeading({
  title,
  icon: Icon,
  tone,
}: Pick<DetailSectionProps, "title" | "icon" | "tone">) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-sm font-semibold leading-none tracking-tight",
        tone === "primary" && "text-primary",
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            tone === "primary" ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden
        />
      ) : null}
      {title}
    </span>
  );
}

/**
 * Card-styled section wrapper shared by every workout-detail surface.
 * Replaces the previous mix of bare <Separator/>-divided blocks and
 * ad-hoc <details> disclosures so each sheet reads as a single column
 * of consistently-titled cards.
 *
 * `collapsible` keeps the native <details>/<summary> pattern (no JS,
 * works in jsdom tests that toggle the element directly); `testId`
 * lands on the <details> root so existing testid-driven assertions
 * keep working. Sections that host autosaving editors must stay
 * non-collapsible — unmounting mid-debounce can drop queued edits.
 */
export function DetailSection({
  title,
  icon,
  children,
  testId,
  action,
  collapsible = false,
  defaultOpen = false,
  tone = "default",
  className,
}: DetailSectionProps) {
  const heading = <SectionHeading title={title} icon={icon} tone={tone} />;

  if (collapsible) {
    return (
      <details
        className={cn(SECTION_CARD, TONE_CLASSNAMES[tone], "group", className)}
        open={defaultOpen || undefined}
        data-testid={testId}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          {heading}
          <span className="flex items-center gap-2">
            {action}
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </span>
        </summary>
        <div className="px-4 pb-4">{children}</div>
      </details>
    );
  }

  return (
    <section className={cn(SECTION_CARD, TONE_CLASSNAMES[tone], className)} data-testid={testId}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        {heading}
        {action}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

interface CoachRationaleSectionProps {
  readonly rationale: string | null | undefined;
  /** "Coach rationale" on completed workouts, "Why this workout" on planned. */
  readonly title?: string;
  readonly testId?: string;
}

/**
 * The coach's explanation for a session, rendered open in a
 * primary-toned card. Previously each surface hid this behind its own
 * collapsed <details>; surfacing it is one of the main wins of the
 * grouped-card layout — the pitch for the workout shouldn't need a tap
 * to find.
 */
export function CoachRationaleSection({
  rationale,
  title = "Coach rationale",
  testId,
}: CoachRationaleSectionProps) {
  if (!rationale) return null;

  return (
    <DetailSection title={title} icon={Sparkles} tone="primary" testId={testId}>
      <p className="text-sm text-foreground/80">{rationale}</p>
    </DetailSection>
  );
}
