import type { LucideIcon } from "lucide-react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface DetailSectionProps {
  readonly title: string;
  readonly icon?: LucideIcon;
  /** Body. Omit (or pass null) for a header-only row. */
  readonly children?: ReactNode;
  readonly testId?: string;
  /** Right-aligned header slot, e.g. a save-state pill or count badge. */
  readonly action?: ReactNode;
  /** Render as a native <details> with the header as its <summary>. */
  readonly collapsible?: boolean;
  readonly defaultOpen?: boolean;
  /** "primary" = coach-voice styling (primary-tinted border/background). */
  readonly tone?: "default" | "primary";
  /**
   * "card" (default) is a standalone card. "row" drops the card chrome so the
   * section sits as one divided row inside a `DetailGroup`.
   */
  readonly variant?: DetailSectionVariant;
  readonly className?: string;
}

export type DetailSectionVariant = "card" | "row";

const SECTION_CARD = "rounded-xl border shadow-sm";
const TONE_CLASSNAMES: Record<NonNullable<DetailSectionProps["tone"]>, string> = {
  default: "border-card-border bg-card text-card-foreground",
  primary: "border-primary/30 bg-primary/5",
};

function sectionChromeFor(
  variant: DetailSectionVariant,
  tone: NonNullable<DetailSectionProps["tone"]>,
): string | undefined {
  // A row borrows its group's card, so the tone only colours its heading.
  return variant === "card" ? cn(SECTION_CARD, TONE_CLASSNAMES[tone]) : undefined;
}

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
  variant = "card",
  className,
}: DetailSectionProps) {
  const heading = <SectionHeading title={title} icon={icon} tone={tone} />;
  const chrome = sectionChromeFor(variant, tone);
  // A header-only row (its action says it all) shouldn't carry body padding.
  const hasBody = children != null && children !== false;

  if (collapsible) {
    return (
      <details
        className={cn(chrome, "group", className)}
        open={defaultOpen || undefined}
        data-testid={testId}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          {heading}
          <span className="flex min-w-0 items-center gap-2">
            {action}
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </span>
        </summary>
        {hasBody ? <div className="px-4 pb-4">{children}</div> : null}
      </details>
    );
  }

  return (
    <section className={cn(chrome, className)} data-testid={testId}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        {heading}
        {action}
      </div>
      {hasBody ? <div className="px-4 pb-4">{children}</div> : null}
    </section>
  );
}

interface DetailGroupProps {
  readonly children: ReactNode;
  readonly label?: string;
  readonly testId?: string;
}

/**
 * One card holding several secondary sections as divided rows (render each
 * with `variant="row"`). Collapsing the supporting context of a sheet into a
 * single list keeps it a glance away without each piece costing a card.
 * Children that render nothing leave no gap: the dividers sit between rows.
 */
export function DetailGroup({ children, label, testId }: DetailGroupProps) {
  return (
    <section
      className={cn(
        SECTION_CARD,
        TONE_CLASSNAMES.default,
        "divide-y divide-border/70 overflow-hidden empty:hidden",
      )}
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </section>
  );
}

/** Muted one-line status for a row's header, e.g. "Not linked". */
export function DetailSummary({ children }: { readonly children: ReactNode }) {
  return <span className="truncate text-xs font-normal text-muted-foreground">{children}</span>;
}

interface CoachRationaleSectionProps {
  readonly rationale: string | null | undefined;
  /** "Coach rationale" on completed workouts, "Why this workout" on planned. */
  readonly title?: string;
  readonly testId?: string;
  /**
   * "row" renders it as a collapsed row of a `DetailGroup` — on a finished
   * workout the pitch is background, not the headline.
   */
  readonly variant?: DetailSectionVariant;
}

/**
 * The coach's explanation for a session, rendered open in a
 * primary-toned card. Previously each surface hid this behind its own
 * collapsed <details>; surfacing it is one of the main wins of the
 * grouped-card layout — the pitch for a workout you're about to do
 * shouldn't need a tap to find. Once the workout is done it's background,
 * so the review sheet folds it into its session details as a closed row.
 */
export function CoachRationaleSection({
  rationale,
  title = "Coach rationale",
  testId,
  variant = "card",
}: CoachRationaleSectionProps) {
  if (!rationale) return null;

  return (
    <DetailSection
      title={title}
      icon={Sparkles}
      tone="primary"
      testId={testId}
      variant={variant}
      collapsible={variant === "row"}
    >
      <p className="text-sm text-foreground/80">{rationale}</p>
    </DetailSection>
  );
}
