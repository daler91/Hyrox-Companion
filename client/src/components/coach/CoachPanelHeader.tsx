import { Button } from "@/components/ui/button";
import { MessageSquare, Trash2, Loader2, X } from "lucide-react";

interface CoachPanelHeaderProps {
  readonly onClearHistory: () => void;
  readonly onClose: () => void;
  readonly isClearingHistory: boolean;
  readonly canClearHistory: boolean;
}

export function CoachPanelHeader({
  onClearHistory,
  onClose,
  isClearingHistory,
  canClearHistory,
}: Readonly<CoachPanelHeaderProps>) {
  return (
    <div className="flex items-center justify-between gap-2 p-3 border-b flex-shrink-0">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">AI Coach</span>
      </div>
      <div className="flex items-center gap-1">
        {canClearHistory && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClearHistory}
            disabled={isClearingHistory}
            title="Clear chat"
            aria-label="Clear chat history"
            data-testid="button-clear-chat"
          >
            {isClearingHistory ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          title="Close coach"
          aria-label="Close coach panel"
          data-testid="button-close-coach"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
