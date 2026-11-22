import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

// Empty states that analytics tabs and charts each wrote out with the same
// markup. Only blocks whose markup matched exactly use these; the others keep
// their own. (CC-analyticsEmpty, REFACTORING_REVIEW 2026-09-23)

/** A tab with nothing to show yet: a card with an icon, a title and a line on how to fill it. */
export function AnalyticsEmptyCard({
  testId,
  icon: Icon,
  title,
  children,
}: Readonly<{ testId: string; icon: LucideIcon; title: string; children: ReactNode }>) {
  return (
    <Card data-testid={testId}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{children}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** A dashed panel with a faded icon over its message, in place of a tab's or chart's content. */
export function AnalyticsEmptyPanel({ icon: Icon, children }: Readonly<{ icon: LucideIcon; children: ReactNode }>) {
  return (
    <div className="flex items-center justify-center py-12 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
      <div>
        <Icon className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

/** A chart with too little data: a small dashed note where the chart would be. */
export function ChartEmptyNote({ testId, children }: Readonly<{ testId?: string; children: ReactNode }>) {
  return (
    <div
      className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground"
      data-testid={testId}
    >
      {children}
    </div>
  );
}
