import type { TimelineAnnotation, TimelineAnnotationType } from "@shared/schema";
import { Loader2, Trash2 } from "lucide-react";

import { TYPE_COLORS, TYPE_LABELS } from "@/components/timeline/annotation-style";
import { AnnotationTypeIcon } from "@/components/timeline/AnnotationTypeIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AnnotationListProps {
  readonly annotations: TimelineAnnotation[] | undefined;
  readonly isLoading: boolean;
  readonly isDeleting: boolean;
  readonly onDelete: (id: string) => void;
}

export function AnnotationList({
  annotations,
  isLoading,
  isDeleting,
  onDelete,
}: AnnotationListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6" data-testid="annotations-loading">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!annotations || annotations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6" data-testid="annotations-empty">
        No annotations yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2" data-testid="annotations-list">
      {annotations.map((annotation) => {
        const annotationType = annotation.type as TimelineAnnotationType;
        return (
          <li
            key={annotation.id}
            className="flex items-start gap-3 rounded border p-3"
            data-testid={`annotation-item-${annotation.id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-[10px] ${TYPE_COLORS[annotationType]}`}>
                  <AnnotationTypeIcon type={annotationType} className="h-3 w-3 mr-1" />
                  {TYPE_LABELS[annotationType]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {annotation.startDate} {"\u2014"} {annotation.endDate}
                </span>
              </div>
              {annotation.note ? (
                <p className="mt-1 text-sm text-foreground">{annotation.note}</p>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(annotation.id)}
              disabled={isDeleting}
              data-testid={`button-delete-annotation-${annotation.id}`}
              aria-label={`Delete ${TYPE_LABELS[annotationType]} annotation`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
