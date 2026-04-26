import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

import { AnnotationCreateForm } from "./annotations/AnnotationCreateForm";
import { AnnotationList } from "./annotations/AnnotationList";
import { useAnnotationForm } from "./annotations/useAnnotationForm";
import {
  useTimelineAnnotationMutations,
  useTimelineAnnotations,
} from "./annotations/useTimelineAnnotationMutations";

interface AnnotationsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Seeds both dates for the create form when a timeline row opens it. */
  readonly initialDate?: string;
}

/**
 * Dialog for listing, creating, and deleting timeline annotations. Edit
 * remains intentionally omitted; users can delete and re-create.
 */
export function AnnotationsDialog({
  open,
  onOpenChange,
  initialDate,
}: Readonly<AnnotationsDialogProps>) {
  const { toast } = useToast();
  const form = useAnnotationForm(initialDate);
  const { data: annotations, isLoading } = useTimelineAnnotations(open);
  const { createMutation, deleteMutation } = useTimelineAnnotationMutations({
    type: form.type,
    onCreated: () => form.setNote(""),
  });

  const handleCreate = () => {
    if (form.endDate < form.startDate) {
      toast({
        title: "Invalid date range",
        description: "End date must be on or after start date.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      type: form.type,
      startDate: form.startDate,
      endDate: form.endDate,
      note: form.note.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
        data-testid="dialog-annotations"
      >
        <DialogHeader>
          <DialogTitle>Training annotations</DialogTitle>
          <DialogDescription>
            Mark periods where injury, illness, travel, or rest affected your training so charts and
            future reviews have the context.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <AnnotationCreateForm
            type={form.type}
            onTypeChange={form.setType}
            startDate={form.startDate}
            onStartDateChange={form.setStartDate}
            endDate={form.endDate}
            onEndDateChange={form.setEndDate}
            note={form.note}
            onNoteChange={form.setNote}
            onCreate={handleCreate}
            isCreating={createMutation.isPending}
          />

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Existing annotations</h3>
            <AnnotationList
              annotations={annotations}
              isLoading={isLoading}
              isDeleting={deleteMutation.isPending}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
