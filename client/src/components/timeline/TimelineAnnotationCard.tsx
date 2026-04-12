import type { TimelineAnnotation, TimelineAnnotationType } from "@shared/schema";
import { differenceInDays, parseISO } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  TYPE_BORDER_COLORS,
  TYPE_COLORS,
  TYPE_LABELS,
} from "./annotation-style";
import { AnnotationTypeIcon } from "./AnnotationTypeIcon";

interface TimelineAnnotationCardProps {
  readonly annotation: TimelineAnnotation;
  readonly onEdit: (annotation: TimelineAnnotation) => void;
  readonly onDelete: (id: string) => void;
  readonly isDeleting?: boolean;
}

/**
 * Inline log card rendered inside a `TimelineDateGroup` on the annotation's
 * start date. Replaces the old page-level `TimelineAnnotationsBanner`: the
 * user sees the injury/illness/travel/rest entry alongside the actual day's
 * workouts, so the context sits next to the data it explains.
 */
export function TimelineAnnotationCard({
  annotation,
  onEdit,
  onDelete,
  isDeleting = false,
}: Readonly<TimelineAnnotationCardProps>) {
  const type = annotation.type as TimelineAnnotationType;
  const label = TYPE_LABELS[type];

  // Inclusive day count — a single-day rest still reads as "1 day".
  const days =
    differenceInDays(parseISO(annotation.endDate), parseISO(annotation.startDate)) + 1;
  const dayLabel = days === 1 ? "1 day" : `${days} days`;
  const rangeLabel =
    annotation.startDate === annotation.endDate
      ? `${annotation.startDate} · ${dayLabel}`
      : `${annotation.startDate} → ${annotation.endDate} · ${dayLabel}`;

  return (
    <div
      role="article"
      aria-label={`${label} annotation, ${rangeLabel}`}
      className={`flex items-start gap-3 rounded-md border border-l-4 bg-muted/20 p-3 ${TYPE_BORDER_COLORS[type]}`}
      data-testid={`annotation-card-${annotation.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-[10px] ${TYPE_COLORS[type]}`}>
            <AnnotationTypeIcon type={type} className="h-3 w-3 mr-1" />
            {label}
          </Badge>
          <span className="text-xs text-muted-foreground">{rangeLabel}</span>
        </div>
        {annotation.note ? (
          <p className="mt-1 text-sm text-foreground break-words">{annotation.note}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onEdit(annotation)}
          aria-label={`Edit ${label} annotation`}
          data-testid={`button-edit-annotation-${annotation.id}`}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onDelete(annotation.id)}
          disabled={isDeleting}
          aria-label={`Delete ${label} annotation`}
          data-testid={`button-delete-annotation-${annotation.id}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
