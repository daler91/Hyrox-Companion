import { createPortal } from "react-dom";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function FloatingActionButton() {
  return createPortal(
    <Link href="/log">
      <Button
        size="icon"
        className="!fixed !bottom-6 !right-6 h-14 w-14 rounded-full shadow-lg"
        style={{ zIndex: 9999 }}
        data-testid="button-log-workout-fab"
      >
        <Plus className="h-6 w-6" />
      </Button>
    </Link>,
    document.body
  );
}
