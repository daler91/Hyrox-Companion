import { ChatInput, type ChatInputSeed } from "@/components/ChatInput";
import { type QuickAction,QuickActions } from "@/components/QuickActions";

interface CoachPanelFooterProps {
  readonly quickActions: QuickAction[];
  readonly onQuickAction: (action: QuickAction) => void;
  readonly onSendMessage: (message: string) => void;
  readonly isProcessing: boolean;
  readonly inputSeed?: ChatInputSeed | null;
}

export function CoachPanelFooter({
  quickActions,
  onQuickAction,
  onSendMessage,
  isProcessing,
  inputSeed,
}: Readonly<CoachPanelFooterProps>) {
  // Hide the generic quick-action grid while a seeded prompt is
  // active — the user just clicked "Ask coach" with a specific
  // topic in mind, so the generic "Analyze my training" /
  // "Pacing tips" buttons compete with their follow-up and make
  // the chat footer feel cluttered.
  const showQuickActions = !inputSeed;
  return (
    <div className="flex-shrink-0 p-2 border-t space-y-2">
      {showQuickActions && (
        <QuickActions actions={quickActions} onSelect={onQuickAction} disabled={isProcessing} />
      )}
      <ChatInput onSend={onSendMessage} isLoading={isProcessing} seed={inputSeed} />
    </div>
  );
}
