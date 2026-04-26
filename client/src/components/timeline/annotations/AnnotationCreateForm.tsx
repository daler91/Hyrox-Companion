import type { TimelineAnnotationType } from "@shared/schema";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CharacterCount } from "@/components/ui/character-count";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface AnnotationCreateFormProps {
  readonly type: TimelineAnnotationType;
  readonly onTypeChange: (type: TimelineAnnotationType) => void;
  readonly startDate: string;
  readonly onStartDateChange: (value: string) => void;
  readonly endDate: string;
  readonly onEndDateChange: (value: string) => void;
  readonly note: string;
  readonly onNoteChange: (value: string) => void;
  readonly onCreate: () => void;
  readonly isCreating: boolean;
}

export function AnnotationCreateForm({
  type,
  onTypeChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  note,
  onNoteChange,
  onCreate,
  isCreating,
}: AnnotationCreateFormProps) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="space-y-2">
        <Label htmlFor="annotation-type">Type</Label>
        <Select
          value={type}
          onValueChange={(value) => onTypeChange(value as TimelineAnnotationType)}
        >
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
            onChange={(event) => onStartDateChange(event.target.value)}
            data-testid="input-annotation-start"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="annotation-end">End</Label>
          <Input
            id="annotation-end"
            type="date"
            value={endDate}
            onChange={(event) => onEndDateChange(event.target.value)}
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
          onChange={(event) => onNoteChange(event.target.value)}
          maxLength={500}
          rows={2}
          aria-describedby="annotation-note-count"
          data-testid="input-annotation-note"
        />
        <CharacterCount id="annotation-note-count" value={note} max={500} />
      </div>
      <Button
        onClick={onCreate}
        disabled={isCreating}
        className="w-full"
        data-testid="button-create-annotation"
      >
        {isCreating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
            Saving...
          </>
        ) : (
          "Add annotation"
        )}
      </Button>
    </div>
  );
}
