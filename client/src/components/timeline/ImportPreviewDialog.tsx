import { FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface CsvPreviewData {
  fileName: string;
  content: string;
  rows: Array<{
    /** The row's place among the file's data rows: unique, unlike week and day. */
    rowNumber: number;
    weekNumber: number;
    dayName: string;
    focus: string;
    mainWorkout: string;
  }>;
  /** Data rows after the previewed ones, blank lines not counted. */
  remainingRows: number;
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
          <DialogDescription className="sr-only">
            Preview of imported file
          </DialogDescription>
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
                  {/* Two sessions on one day shared a week-day key (CL49,
                      CODEBASE_ANALYSIS_2026-10-03). */}
                  {preview?.rows.map((row) => (
                    <tr key={row.rowNumber} className="border-t">
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
          {/* Counted by the CSV parse, not raw lines: a trailing newline was
              one more workout (CL49, CODEBASE_ANALYSIS_2026-10-03). */}
          {preview && preview.remainingRows > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              ... and {preview.remainingRows} more workouts
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
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
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
