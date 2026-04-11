import { ArrowLeft, Copy, Loader2 } from "lucide-react";
import React from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";

interface WorkoutHeaderProps {
  /**
   * Optional: when provided, renders a "Duplicate last" button that
   * pre-fills the form from the user's most recent logged workout.
   * Omit to hide the button (e.g. in tests or contexts without a
   * duplicate handler).
   */
  onDuplicateLast?: () => void;
  /** Whether the duplicate fetch is currently in flight. */
  isDuplicating?: boolean;
}

export function WorkoutHeader({ onDuplicateLast, isDuplicating }: Readonly<WorkoutHeaderProps> = {}) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" asChild data-testid="button-back" aria-label="Back to timeline">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="flex-1">
        <h1 className="text-3xl font-bold tracking-tight">Log Workout</h1>
        <p className="text-muted-foreground mt-1">
          Record your training session
        </p>
      </div>
      {onDuplicateLast ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onDuplicateLast}
          disabled={isDuplicating}
          data-testid="button-duplicate-last"
        >
          {isDuplicating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4 mr-2" aria-hidden="true" />
          )}
          Duplicate last
        </Button>
      ) : null}
    </div>
  );
}
