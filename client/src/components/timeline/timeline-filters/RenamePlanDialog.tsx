import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface RenamePlanDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly renameName: string;
  readonly setRenameName: (name: string) => void;
  readonly onSubmit: () => void;
  readonly isRenaming?: boolean;
}

export function RenamePlanDialog({
  open,
  onOpenChange,
  renameName,
  setRenameName,
  onSubmit,
  isRenaming,
}: Readonly<RenamePlanDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Training Plan</DialogTitle>
        </DialogHeader>
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          placeholder="Plan name"
          aria-label="Plan name"
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          data-testid="input-rename-plan"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!renameName.trim() || isRenaming}
            data-testid="button-rename-submit"
          >
            {isRenaming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
