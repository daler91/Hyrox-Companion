import { createPortal } from "react-dom";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function FloatingActionButton() {
  return createPortal(
    <Link href="/log">
      <Button
        className="!fixed !bottom-6 !right-6 rounded-full shadow-lg gap-2"
        style={{ zIndex: 9999 }}
        data-testid="button-log-workout-fab"
      >
        <Plus className="h-5 w-5" />
        <span>New Workout</span>
      </Button>
    </Link>,
    document.body
  );
}
