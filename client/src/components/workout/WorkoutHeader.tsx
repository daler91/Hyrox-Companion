import { ArrowLeft } from "lucide-react";
import React from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";

export function WorkoutHeader() {
  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" asChild data-testid="button-back" aria-label="Back to timeline">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Log Workout</h1>
        <p className="text-muted-foreground mt-1">
          Record your training session
        </p>
      </div>
    </div>
  );
}
