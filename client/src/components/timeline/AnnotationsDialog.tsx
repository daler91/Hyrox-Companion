import type { InsertTimelineAnnotation, TimelineAnnotation, TimelineAnnotationType } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Heart, Loader2, Plane, Stethoscope, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

interface AnnotationsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const TYPE_LABELS: Record<TimelineAnnotationType, string> = {
  injury: "Injury",
  illness: "Illness",
  travel: "Travel",
  rest: "Rest block",
};

// Matches the Tailwind color ramp used on the Timeline banner (see
// TimelineAnnotationsBanner) so the dialog, banner, and Analytics chart
// render the same types in the same colors.
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
  return Heart; // rest → reuse Heart for now
}

/**
 * Dialog for listing, creating, and deleting timeline annotations. Kept
 * intentionally simple: the inline form at the top creates a new entry,
 * the list below shows existing entries with a delete button each. Edit
 * isn't wired in this first pass — users can delete and re-create.
 */
export function AnnotationsDialog({ open, onOpenChange }: Readonly<AnnotationsDialogProps>) {
  const { toast } = useToast();

  const [type, setType] = useState<TimelineAnnotationType>("injury");
  const [startDate, setStartDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [note, setNote] = useState("");

  const { data: annotations, isLoading } = useQuery<TimelineAnnotation[]>({
    queryKey: QUERY_KEYS.timelineAnnotations,
    queryFn: () => api.timelineAnnotations.list(),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertTimelineAnnotation) => api.timelineAnnotations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timelineAnnotations }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(() => {});
      toast({ title: "Annotation added", description: `${TYPE_LABELS[type]} saved to your timeline.` });
      setNote("");
    },
    onError: () =>
      toast({
        title: "Couldn't add annotation",
        description: "Please try again.",
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.timelineAnnotations.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timelineAnnotations }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(() => {});
      toast({ title: "Annotation removed" });
    },
    onError: () =>
      toast({
        title: "Couldn't delete annotation",
        description: "Please try again.",
        variant: "destructive",
      }),
  });

  const handleCreate = () => {
    if (endDate < startDate) {
      toast({
        title: "Invalid date range",
        description: "End date must be on or after start date.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      type,
      startDate,
      endDate,
      note: note.trim() || null,
    });
  };

  // Render-helper computed up front instead of nested inside JSX — keeps
  // the list section readable and avoids a Sonar nested-ternary flag.
  const renderExistingAnnotationsList = () => {
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
          const Icon = getTypeIcon(annotation.type as TimelineAnnotationType);
          return (
            <li
              key={annotation.id}
              className="flex items-start gap-3 rounded border p-3"
              data-testid={`annotation-item-${annotation.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${TYPE_COLORS[annotation.type as TimelineAnnotationType]}`}
                  >
                    <Icon className="h-3 w-3 mr-1" aria-hidden="true" />
                    {TYPE_LABELS[annotation.type as TimelineAnnotationType]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {annotation.startDate} — {annotation.endDate}
                  </span>
                </div>
                {annotation.note ? (
                  <p className="mt-1 text-sm text-foreground">{annotation.note}</p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteMutation.mutate(annotation.id)}
                disabled={deleteMutation.isPending}
                data-testid={`button-delete-annotation-${annotation.id}`}
                aria-label={`Delete ${TYPE_LABELS[annotation.type as TimelineAnnotationType]} annotation`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-annotations">
        <DialogHeader>
          <DialogTitle>Training annotations</DialogTitle>
          <DialogDescription>
            Mark periods where injury, illness, travel, or rest affected your training
            so charts and future reviews have the context.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Create form */}
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-2">
              <Label htmlFor="annotation-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TimelineAnnotationType)}>
                <SelectTrigger id="annotation-type" data-testid="select-annotation-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="injury">Injury</SelectItem>
                  <SelectItem value="illness">Illness</SelectItem>
                  <SelectItem value="travel">Travel</SelectItem>
                  <SelectItem value="rest">Rest block</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="annotation-start">Start</Label>
                <Input
                  id="annotation-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  data-testid="input-annotation-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="annotation-end">End</Label>
                <Input
                  id="annotation-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  data-testid="input-annotation-end"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="annotation-note">Note (optional)</Label>
              <Textarea
                id="annotation-note"
                placeholder="Calf strain during sled push"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                data-testid="input-annotation-note"
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="w-full"
              data-testid="button-create-annotation"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                  Saving...
                </>
              ) : (
                "Add annotation"
              )}
            </Button>
          </div>

          {/* Existing annotations list */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Existing annotations</h3>
            {renderExistingAnnotationsList()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
