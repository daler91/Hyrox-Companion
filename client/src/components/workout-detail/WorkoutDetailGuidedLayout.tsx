import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface WorkoutDetailGuidedLayoutProps {
  readonly children: ReactNode;
  readonly sidebar: ReactNode;
  readonly chatOpen: boolean;
}

export function WorkoutDetailGuidedLayout({
  children,
  sidebar,
  chatOpen,
}: WorkoutDetailGuidedLayoutProps) {
  // Drop the second column entirely when there's no sidebar content (the
  // slimmed planned-overview hides Coach Take + History to keep the
  // primary CTA the focal point). Without this, the grid still reserves
  // the 300px sidebar track and the body is artificially narrow.
  const hasSidebar = sidebar != null && sidebar !== false;
  return (
    <div
      className={cn(
        "grid grid-cols-1 items-start gap-4 px-4 py-4 sm:px-6",
        hasSidebar &&
          (chatOpen
            ? "md:grid-cols-[minmax(0,1fr)_380px] lg:grid-cols-[minmax(0,1fr)_420px]"
            : "md:grid-cols-[minmax(0,1fr)_300px]"),
      )}
      data-testid="workout-detail-guided-layout"
    >
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      {hasSidebar && (
        <aside className="flex min-h-0 self-start flex-col gap-3" data-testid="workout-detail-coach-section">
          {sidebar}
        </aside>
      )}
    </div>
  );
}

interface WorkoutDetailSectionProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly testId?: string;
}

export function WorkoutDetailSection({
  title,
  children,
  action,
  testId,
}: WorkoutDetailSectionProps) {
  return (
    <section className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function WorkoutDetailOverview({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <WorkoutDetailSection title="Overview" testId="workout-detail-overview">
      <div className="rounded-lg border border-border bg-muted/15 px-3 py-3">
        {children}
      </div>
    </WorkoutDetailSection>
  );
}

export function WorkoutDetailReflection({
  children,
  emphasized = false,
}: Readonly<{ children: ReactNode; emphasized?: boolean }>) {
  return (
    <WorkoutDetailSection title="Reflection" testId="workout-detail-reflection">
      <div
        className={cn(
          "rounded-lg border px-3 py-3",
          emphasized
            ? "border-foreground/15 bg-muted/20 px-4 py-4"
            : "border-border bg-background",
        )}
      >
        {children}
      </div>
    </WorkoutDetailSection>
  );
}

export function PlannedWorkoutDetailContent({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}

export function CompletedWorkoutDetailContent({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
