import React from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WorkoutHeader() {
  return (
    <div className="flex items-center gap-4 mb-6">
      <Link href="/">
        <Button variant="ghost" size="icon">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </Link>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Log Workout</h1>
        <p className="text-muted-foreground mt-1">
          Record your training session
        </p>
      </div>
    </div>
  );
}
