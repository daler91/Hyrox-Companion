import { Bot,User } from "lucide-react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";

import { RagDebugBadge } from "@/components/RagDebugBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { RagInfo } from "@/hooks/useChatSession";

interface ChatMessageProps {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp?: string;
  readonly ragInfo?: RagInfo;
}

// ⚡ Perf: React.memo prevents re-rendering unchanged messages during streaming.
// During AI response streaming, setMessages fires on every token chunk, triggering
// a re-render of the entire message list. Without memo, all N messages re-render
// per chunk; with memo, only the actively streaming message re-renders (~N-1 fewer
// re-renders per chunk). All props are primitives or stable references, so the
// default shallow comparison works correctly.
export const ChatMessage = memo(function ChatMessage({ role, content, timestamp, ragInfo }: Readonly<ChatMessageProps>) {
  const isUser = role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`} data-testid={`message-${role}`}>
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-secondary"}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[80%]`}>
        <div
          className={`rounded-lg px-4 py-3 ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-card border"
          }`}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>
        {timestamp && (
          <span
            className="text-xs text-muted-foreground mt-1"
            aria-label={`sent ${timestamp}`}
          >
            {timestamp}
          </span>
        )}
        {!isUser && ragInfo && <RagDebugBadge ragInfo={ragInfo} />}
      </div>
    </div>
  );
});
ChatMessage.displayName = "ChatMessage";
