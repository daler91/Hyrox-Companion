import { Loader2, MessageSquare, Trash2, X } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
import { Button } from "@/components/ui/button";
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = () => {
    onClearHistory();
    setConfirmOpen(false);
  };

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
                  onClick={() => setConfirmOpen(true)}
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
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Clear chat history?"
        description="This will permanently delete your entire conversation with the AI coach. This action cannot be undone."
        confirmText={isClearingHistory ? "Clearing..." : "Clear history"}
        cancelText="Cancel"
        onConfirm={handleConfirm}
        isPending={isClearingHistory}
        isDestructive
        cancelTestId="button-cancel-clear-chat"
        confirmTestId="button-confirm-clear-chat"
      />
    </TooltipProvider>
  );
}
