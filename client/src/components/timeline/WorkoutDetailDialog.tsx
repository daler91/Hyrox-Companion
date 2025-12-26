import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  Pencil,
  Trash2,
  Flame,
  Zap,
  Activity,
  TrendingUp,
  Combine,
  Save,
  X,
} from "lucide-react";
import { SiStrava } from "react-icons/si";
import type { TimelineEntry, WorkoutStatus } from "@shared/schema";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { formatSpeed } from "@shared/unitConversion";

interface WorkoutDetailDialogProps {
  entry: TimelineEntry | null;
  onClose: () => void;
  onMarkComplete: (entry: TimelineEntry) => void;
  onChangeStatus: (entry: TimelineEntry, status: WorkoutStatus) => void;
  onSave: (updates: { focus: string; mainWorkout: string; accessory: string | null; notes: string | null }) => void;
  onDelete: (entry: TimelineEntry) => void;
  onCombine?: (entry: TimelineEntry) => void;
  isSaving?: boolean;
  isDeleting?: boolean;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    case "planned":
      return (
        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Clock className="h-3 w-3 mr-1" />
          Planned
        </Badge>
      );
    case "missed":
      return (
        <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
          <XCircle className="h-3 w-3 mr-1" />
          Missed
        </Badge>
      );
    case "skipped":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
          <SkipForward className="h-3 w-3 mr-1" />
          Skipped
        </Badge>
      );
    default:
      return null;
  }
}

export default function WorkoutDetailDialog({
  entry,
  onClose,
  onMarkComplete,
  onChangeStatus,
  onSave,
  onDelete,
  onCombine,
  isSaving,
  isDeleting,
}: WorkoutDetailDialogProps) {
  const { distanceUnit } = useUnitPreferences();
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editForm, setEditForm] = useState({
    focus: "",
    mainWorkout: "",
    accessory: "",
    notes: "",
  });

  useEffect(() => {
    if (entry) {
      setEditForm({
        focus: entry.focus,
        mainWorkout: entry.mainWorkout,
        accessory: entry.accessory || "",
        notes: entry.notes || "",
      });
      setIsEditing(false);
    }
  }, [entry]);

  if (!entry) return null;

  const hasPlanDayId = !!entry.planDayId;
  const hasWorkoutLogId = !!entry.workoutLogId;
  const canEdit = hasPlanDayId || hasWorkoutLogId;
  const canDelete = hasPlanDayId || hasWorkoutLogId;
  const canChangeStatus = hasPlanDayId;

  const handleSave = () => {
    onSave({
      focus: editForm.focus,
      mainWorkout: editForm.mainWorkout,
      accessory: editForm.accessory || null,
      notes: editForm.notes || null,
    });
  };

  const handleClose = () => {
    setIsEditing(false);
    setConfirmingDelete(false);
    onClose();
  };

  const handleDeleteClick = () => {
    setConfirmingDelete(true);
  };

  const handleConfirmDelete = () => {
    onDelete(entry);
    setConfirmingDelete(false);
  };

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            {getStatusBadge(entry.status)}
            {entry.source === "strava" && (
              <Badge className="bg-[#FC4C02]/10 text-[#FC4C02]">
                <SiStrava className="h-3 w-3 mr-1" />
                Strava
              </Badge>
            )}
            {entry.dayName && (
              <Badge variant="secondary">{entry.dayName}</Badge>
            )}
          </div>
          <DialogTitle className="text-left mt-2">
            {isEditing ? "Edit Workout" : entry.focus}
          </DialogTitle>
          <DialogDescription className="sr-only">
            View and manage workout details
          </DialogDescription>
        </DialogHeader>

        {isEditing ? (
          <div className="space-y-4">
            <div>
              <Label htmlFor="detail-focus">Focus</Label>
              <Input
                id="detail-focus"
                value={editForm.focus}
                onChange={(e) => setEditForm({ ...editForm, focus: e.target.value })}
                data-testid="input-detail-focus"
              />
            </div>
            <div>
              <Label htmlFor="detail-main">Main Workout</Label>
              <Textarea
                id="detail-main"
                value={editForm.mainWorkout}
                onChange={(e) => setEditForm({ ...editForm, mainWorkout: e.target.value })}
                rows={3}
                data-testid="input-detail-main"
              />
            </div>
            <div>
              <Label htmlFor="detail-accessory">Accessory/Engine Work</Label>
              <Textarea
                id="detail-accessory"
                value={editForm.accessory}
                onChange={(e) => setEditForm({ ...editForm, accessory: e.target.value })}
                rows={2}
                data-testid="input-detail-accessory"
              />
            </div>
            <div>
              <Label htmlFor="detail-notes">Notes</Label>
              <Input
                id="detail-notes"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                data-testid="input-detail-notes"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">{entry.mainWorkout}</p>
            </div>
            {entry.accessory && (
              <div>
                <p className="text-xs font-medium text-muted-foreground/70 mb-1">Accessory</p>
                <p className="text-sm text-muted-foreground/70">{entry.accessory}</p>
              </div>
            )}
            {entry.notes && (
              <div>
                <p className="text-xs font-medium text-muted-foreground/70 mb-1">Notes</p>
                <p className="text-sm text-muted-foreground italic">{entry.notes}</p>
              </div>
            )}
            {entry.duration && entry.source !== "strava" && (
              <p className="text-xs text-muted-foreground">
                Duration: {entry.duration} min
                {entry.rpe && ` | RPE: ${entry.rpe}`}
              </p>
            )}
            {entry.source === "strava" && (entry.calories || entry.avgWatts || entry.sufferScore || entry.avgCadence || entry.avgSpeed) && (
              <div className="flex flex-wrap gap-3 pt-2 border-t border-border/50">
                {entry.calories && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Flame className="h-3 w-3 text-orange-500" />
                    <span>{entry.calories} cal</span>
                  </div>
                )}
                {entry.avgWatts && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Zap className="h-3 w-3 text-yellow-500" />
                    <span>{entry.avgWatts}W</span>
                  </div>
                )}
                {entry.avgCadence && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Activity className="h-3 w-3 text-blue-500" />
                    <span>{Math.round(entry.avgCadence)} spm</span>
                  </div>
                )}
                {entry.avgSpeed && entry.avgSpeed > 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="h-3 w-3 text-green-500" />
                    <span>{formatSpeed(entry.avgSpeed, distanceUnit)}</span>
                  </div>
                )}
                {entry.sufferScore && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="h-3 w-3 text-purple-500" />
                    <span>Effort: {entry.sufferScore}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {canChangeStatus && !isEditing && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Change Status</p>
              <div className="flex flex-wrap gap-2">
                {entry.status !== "completed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-600 border-green-200 dark:border-green-800"
                    onClick={() => onMarkComplete(entry)}
                    data-testid="button-detail-complete"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Complete
                  </Button>
                )}
                {entry.status !== "skipped" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-yellow-600 border-yellow-200 dark:border-yellow-800"
                    onClick={() => onChangeStatus(entry, "skipped")}
                    data-testid="button-detail-skip"
                  >
                    <SkipForward className="h-4 w-4 mr-1" />
                    Skip
                  </Button>
                )}
                {entry.status !== "missed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 dark:border-red-800"
                    onClick={() => onChangeStatus(entry, "missed")}
                    data-testid="button-detail-missed"
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Missed
                  </Button>
                )}
                {entry.status !== "planned" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-blue-600 border-blue-200 dark:border-blue-800"
                    onClick={() => onChangeStatus(entry, "planned")}
                    data-testid="button-detail-planned"
                  >
                    <Clock className="h-4 w-4 mr-1" />
                    Planned
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {isEditing ? (
            <>
              <Button
                variant="outline"
                onClick={() => setIsEditing(false)}
                className="sm:mr-auto"
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                data-testid="button-detail-save"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save Changes
              </Button>
            </>
          ) : (
            <>
              <div className="flex gap-2 sm:mr-auto flex-wrap">
                {canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                    data-testid="button-detail-edit"
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
                {onCombine && (
                  <Button
                    variant="outline"
                    onClick={() => onCombine(entry)}
                    data-testid="button-detail-combine"
                  >
                    <Combine className="h-4 w-4 mr-1" />
                    Combine
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={handleDeleteClick}
                    disabled={isDeleting}
                    data-testid="button-detail-delete"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-1" />
                    )}
                    Delete
                  </Button>
                )}
              </div>
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this workout? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {isDeleting ? "Deleting..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
