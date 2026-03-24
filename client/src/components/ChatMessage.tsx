import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { User, Bot } from "lucide-react";
import { RagDebugBadge } from "@/components/RagDebugBadge";
import type { RagInfo } from "@/hooks/useChatSession";

interface ChatMessageProps {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp?: string;
  readonly ragInfo?: RagInfo;
}

export function ChatMessage({ role, content, timestamp, ragInfo }: Readonly<ChatMessageProps>) {
  const isUser = role === "user";

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
      data-testid={`message-${role}`}
    >
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-secondary"}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[80%]`}>
        <div
          className={`rounded-lg px-4 py-3 ${
            isUser ? "bg-primary text-primary-foreground" : "bg-card border"
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        </div>
        {timestamp && <span className="text-xs text-muted-foreground mt-1">{timestamp}</span>}
        {!isUser && ragInfo && <RagDebugBadge ragInfo={ragInfo} />}
      </div>
    </div>
  );
}
