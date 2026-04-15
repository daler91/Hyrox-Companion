import type { InsertTimelineAnnotation, TimelineAnnotation, TimelineAnnotationType } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CharacterCount } from "@/components/ui/character-count";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { TYPE_COLORS, TYPE_LABELS } from "./annotation-style";
import { AnnotationTypeIcon } from "./AnnotationTypeIcon";

interface AnnotationsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** When provided, seeds both `startDate` and `endDate` for the create
   * form on the closed→open transition — used by the inline "Log a note"
   * buttons on each `TimelineDateGroup` header so the user doesn't have to
   * re-pick the date they just clicked on. */
  readonly initialDate?: string;
}

/**
 * Dialog for listing, creating, and deleting timeline annotations. Kept
 * intentionally simple: the inline form at the top creates a new entry,
 * the list below shows existing entries with a delete button each. Edit
 * isn't wired in this first pass — users can delete and re-create.
 */
export function AnnotationsDialog({ open, onOpenChange, initialDate }: Readonly<AnnotationsDialogProps>) {
  const { toast } = useToast();

  const [type, setType] = useState<TimelineAnnotationType>("injury");
  const [startDate, setStartDate] = useState(() => initialDate ?? format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(() => initialDate ?? format(new Date(), "yyyy-MM-dd"));
  const [note, setNote] = useState("");

  // React's "store info from previous renders" pattern: when the parent
  // hands us a fresh `initialDate` (the user clicked a different day's
  // inline + Note chip), we reseed the create form's dates on the next
  // render. Setting state during render — as opposed to inside a
  // useEffect — is the idiomatic way to derive state from a prop change
  // without cascading re-renders.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevInitialDate, setPrevInitialDate] = useState(initialDate);
  if (initialDate !== prevInitialDate) {
    setPrevInitialDate(initialDate);
    if (initialDate) {
      setStartDate(initialDate);
      setEndDate(initialDate);
    }
  }

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
          const annotationType = annotation.type as TimelineAnnotationType;
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
                    className={`text-[10px] ${TYPE_COLORS[annotationType]}`}
                  >
                    <AnnotationTypeIcon type={annotationType} className="h-3 w-3 mr-1" />
                    {TYPE_LABELS[annotationType]}
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
                aria-label={`Delete ${TYPE_LABELS[annotationType]} annotation`}
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
                aria-describedby="annotation-note-count"
                data-testid="input-annotation-note"
              />
              <CharacterCount id="annotation-note-count" value={note} max={500} />
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
