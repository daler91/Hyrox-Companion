import { Check, Pencil, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface EditableWorkoutTitleProps {
  readonly title: string | null | undefined;
  readonly fallbackTitle: string;
  readonly onSave?: (title: string) => void;
  readonly isSaving?: boolean;
  readonly testIdPrefix: string;
}

function getDisplayTitle(title: string | null | undefined, fallbackTitle: string): string {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallbackTitle;
}

export function EditableWorkoutTitle({
  title,
  fallbackTitle,
  onSave,
  isSaving = false,
  testIdPrefix,
}: EditableWorkoutTitleProps) {
  const displayTitle = getDisplayTitle(title, fallbackTitle);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(displayTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const startEditing = () => {
    setDraft(displayTitle);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraft(displayTitle);
    setIsEditing(false);
  };

  const saveDraft = () => {
    const nextTitle = draft.trim();
    if (!nextTitle) return;
    if (nextTitle !== displayTitle) {
      onSave?.(nextTitle);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveDraft();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  };

  if (!onSave) {
    return (
      <span className="min-w-0 truncate" data-testid={`${testIdPrefix}-text`}>
        {displayTitle}
      </span>
    );
  }

  if (isEditing) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          aria-label="Workout title"
          className="h-8 min-w-0"
          data-testid={`${testIdPrefix}-input`}
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={saveDraft}
                disabled={isSaving || draft.trim().length === 0}
                aria-label="Save workout title"
                data-testid={`${testIdPrefix}-save`}
              >
                <Check className="h-4 w-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Save title</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={cancelEditing}
                disabled={isSaving}
                aria-label="Cancel title edit"
                data-testid={`${testIdPrefix}-cancel`}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Cancel</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 truncate" data-testid={`${testIdPrefix}-text`}>
        {displayTitle}
      </span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={startEditing}
              disabled={isSaving}
              aria-label="Edit workout title"
              data-testid={`${testIdPrefix}-edit`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Edit workout title</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}
