import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface CoachingUploadDialogProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  dialogType: "principles" | "document";
  title: string;
  setTitle: (title: string) => void;
  content: string;
  setContent: (content: string) => void;
  handleSave: () => void;
  isSaving: boolean;
}

export function CoachingUploadDialog({
  dialogOpen,
  setDialogOpen,
  dialogType,
  title,
  setTitle,
  content,
  setContent,
  handleSave,
  isSaving,
}: CoachingUploadDialogProps) {
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {dialogType === "principles" ? "Add Training Principles" : "Upload Document"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="material-title">Title</Label>
            <Input
              id="material-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 255))}
              placeholder="e.g., Periodization Guidelines"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="material-content">
              {dialogType === "principles" ? "Training Principles" : "Document Content"}
            </Label>
            <Textarea
              id="material-content"
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, 1500000))}
              placeholder={
                dialogType === "principles"
                  ? "Paste your training principles, programming rules, or key excerpts here..."
                  : "Document content will appear here after upload..."
              }
              className="min-h-[200px]"
              rows={10}
            />
            <p className="text-xs text-muted-foreground text-right">
              {content.length.toLocaleString()}/1,500,000
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!title.trim() || !content.trim() || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
