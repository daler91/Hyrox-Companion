import { ChatInput } from "@/components/ChatInput";
import { type QuickAction,QuickActions } from "@/components/QuickActions";

interface CoachPanelFooterProps {
  readonly quickActions: QuickAction[];
  readonly onQuickAction: (action: QuickAction) => void;
  readonly onSendMessage: (message: string) => void;
  readonly onStopMessage?: () => void;
  readonly isProcessing: boolean;
}

export function CoachPanelFooter({
  quickActions,
  onQuickAction,
  onSendMessage,
  onStopMessage,
  isProcessing,
}: Readonly<CoachPanelFooterProps>) {
  return (
    <div className="flex-shrink-0 p-2 border-t space-y-2">
      <QuickActions actions={quickActions} onSelect={onQuickAction} disabled={isProcessing} />
      <ChatInput onSend={onSendMessage} onStop={onStopMessage} isLoading={isProcessing} />
    </div>
  );
}
