import type { TimelineAnnotation, TimelineAnnotationType } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { Heart, Info, Pencil, Plane, Plus, Stethoscope } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, QUERY_KEYS } from "@/lib/api";

interface TimelineAnnotationsBannerProps {
  /** Fired when the user clicks the Edit / Manage button. */
  readonly onOpenDialog: () => void;
}

const TYPE_LABELS: Record<TimelineAnnotationType, string> = {
  injury: "Injury",
  illness: "Illness",
  travel: "Travel",
  rest: "Rest",
};

const TYPE_COLORS: Record<TimelineAnnotationType, string> = {
  injury: "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400",
  illness: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400",
  travel: "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-400",
  rest: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
};

function getTypeIcon(type: TimelineAnnotationType) {
  if (type === "injury") return Heart;
  if (type === "illness") return Stethoscope;
  if (type === "travel") return Plane;
  return Heart;
}

/**
 * Compact banner rendered above the Timeline filters that surfaces the
 * user's active annotations (injury / illness / travel / rest periods).
 * When the list is empty the banner renders a one-line empty-state hint
 * with an "Add annotation" button — otherwise `onOpenDialog` would have
 * no entry point on a clean account, since this banner is the only
 * caller of `setAnnotationsDialogOpen(true)` on Timeline.
 */
export function TimelineAnnotationsBanner({ onOpenDialog }: Readonly<TimelineAnnotationsBannerProps>) {
  const { data: annotations } = useQuery<TimelineAnnotation[]>({
    queryKey: QUERY_KEYS.timelineAnnotations,
    queryFn: () => api.timelineAnnotations.list(),
  });

  if (!annotations || annotations.length === 0) {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3"
        data-testid="banner-timeline-annotations-empty"
      >
        <Info className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <p className="flex-1 text-xs text-muted-foreground">
          Track injuries, illness, travel, or rest periods to explain dips in your training volume.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenDialog}
          data-testid="button-add-first-annotation"
        >
          <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
          Add annotation
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 rounded-lg border bg-muted/20 px-4 py-3"
      data-testid="banner-timeline-annotations"
    >
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Active annotations
        </p>
        <ul className="flex flex-wrap gap-2">
          {annotations.map((annotation) => {
            const type = annotation.type as TimelineAnnotationType;
            const Icon = getTypeIcon(type);
            return (
              <li key={annotation.id}>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${TYPE_COLORS[type]}`}
                  title={annotation.note ?? undefined}
                  data-testid={`banner-annotation-${annotation.id}`}
                >
                  <Icon className="h-3 w-3 mr-1" aria-hidden="true" />
                  {TYPE_LABELS[type]} · {annotation.startDate} → {annotation.endDate}
                </Badge>
              </li>
            );
          })}
        </ul>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenDialog}
        data-testid="button-manage-annotations"
      >
        <Pencil className="h-4 w-4 mr-1" aria-hidden="true" />
        Manage
      </Button>
    </div>
  );
}
