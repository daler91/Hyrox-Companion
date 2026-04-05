import { Button } from "@/components/ui/button";
import { MessageSquare, Trash2, Loader2, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
    <TooltipProvider>
      <div className="flex items-center justify-between gap-2 p-3 border-b flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">AI Coach</span>
        </div>
        <div className="flex items-center gap-1">
          {canClearHistory && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClearHistory}
                  disabled={isClearingHistory}
                  aria-label="Clear chat history"
                  data-testid="button-clear-chat"
                >
                  {isClearingHistory ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Clear chat</p>
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close coach panel"
                data-testid="button-close-coach"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Close coach</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
