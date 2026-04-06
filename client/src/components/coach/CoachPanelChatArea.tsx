import { forwardRef } from "react";

import { ChatMessage } from "@/components/ChatMessage";
import { SuggestionsList } from "@/components/coach/SuggestionsTab";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Message } from "@/hooks/useChatSession";
import type { RagInfo,Suggestion } from "@/lib/api";

interface CoachPanelChatAreaProps {
  readonly messages: Message[];
  readonly pendingSuggestions: Suggestion[];
  readonly applyingId: string | null;
  readonly suggestionsRagInfo?: RagInfo;
  readonly isProcessing: boolean;
  readonly onApplySuggestion: (suggestion: Suggestion) => void;
  readonly onDismissSuggestion: (id: string) => void;
}

export const CoachPanelChatArea = forwardRef<HTMLDivElement, CoachPanelChatAreaProps>(
  (
    {
      messages,
      pendingSuggestions,
      applyingId,
      suggestionsRagInfo,
      isProcessing,
      onApplySuggestion,
      onDismissSuggestion,
    },
    ref
  ) => {
    return (
      <ScrollArea className="flex-1 p-3" ref={ref}>
        <div className="space-y-3" role="log" aria-live="polite" aria-label="Coach conversation">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
              ragInfo={message.ragInfo}
            />
          ))}
          <SuggestionsList
            suggestions={pendingSuggestions}
            applyingId={applyingId}
            ragInfo={suggestionsRagInfo}
            onApply={onApplySuggestion}
            onDismiss={onDismissSuggestion}
          />
          {isProcessing && (
            <div className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
              <div className="flex gap-1" aria-hidden="true">
                <span
                  className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
              <span className="text-xs">Thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>
    );
  }
);
CoachPanelChatArea.displayName = "CoachPanelChatArea";
