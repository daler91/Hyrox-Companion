import { MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";

interface MobileCoachToggleProps {
  readonly onClick?: () => void;
  readonly testId: string;
  readonly visible: boolean;
}

export function MobileCoachToggle({ onClick, testId, visible }: MobileCoachToggleProps) {
  if (!visible || !onClick) return null;

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full justify-center"
      onClick={onClick}
      data-testid={testId}
    >
      <MessageSquare className="mr-2 h-4 w-4" />
      Return to coach chat
    </Button>
  );
}
