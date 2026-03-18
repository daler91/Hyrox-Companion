import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { FileText, Loader2 } from "lucide-react";

export interface CsvPreviewData {
  fileName: string;
  content: string;
  rows: Array<{
    weekNumber: number;
    dayName: string;
    focus: string;
    mainWorkout: string;
  }>;
}

interface ImportPreviewDialogProps {
  readonly preview: CsvPreviewData | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}

export default function ImportPreviewDialog({
  preview,
  onOpenChange,
  onConfirm,
  isPending,
}: Readonly<ImportPreviewDialogProps>) {
  return (
    <Dialog
      open={!!preview}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Import Preview: {preview?.fileName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Preview of first {preview?.rows.length} workouts from your training
            plan:
          </p>
          <div className="border rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium">Week</th>
                    <th className="text-left p-2 font-medium">Day</th>
                    <th className="text-left p-2 font-medium">Focus</th>
                    <th className="text-left p-2 font-medium">Main Workout</th>
                  </tr>
                </thead>
                <tbody>
                  {preview?.rows.map((row) => (
                    <tr
                      key={`${row.weekNumber}-${row.dayName}`}
                      className="border-t"
                    >
                      <td className="p-2">{row.weekNumber}</td>
                      <td className="p-2">{row.dayName}</td>
                      <td className="p-2">{row.focus}</td>
                      <td
                        className="p-2 max-w-[200px] truncate"
                        title={row.mainWorkout}
                      >
                        {row.mainWorkout}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {preview && preview.content.split("\n").length > 11 && (
            <p className="text-xs text-muted-foreground text-center">
              ... and {preview.content.split("\n").length - 11} more workouts
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            data-testid="button-confirm-import"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              "Confirm Import"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
