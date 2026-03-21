import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { User, Bot, Database, FileText, ChevronDown, ChevronRight } from "lucide-react";
import type { RagInfo } from "@/hooks/useChatSession";

interface ChatMessageProps {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp?: string;
  readonly ragInfo?: RagInfo;
}

function RagDebugBadge({ ragInfo }: { ragInfo: RagInfo }) {
  const [expanded, setExpanded] = useState(false);

  const badgeColor =
    ragInfo.source === "rag"
      ? "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800"
      : ragInfo.source === "legacy"
        ? "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800"
        : "text-muted-foreground bg-muted border-border";

  const Icon = ragInfo.source === "rag" ? Database : FileText;
  const label =
    ragInfo.source === "rag"
      ? `RAG: ${ragInfo.chunkCount} chunks`
      : ragInfo.source === "legacy"
        ? `Legacy: ${ragInfo.materialCount ?? 0} materials`
        : "No coaching data";

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${badgeColor} hover:opacity-80 transition-opacity`}
      >
        <Icon className="h-2.5 w-2.5" />
        {label}
        {ragInfo.source === "rag" && ragInfo.chunks && ragInfo.chunks.length > 0 && (
          expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />
        )}
      </button>
      {expanded && ragInfo.source === "rag" && ragInfo.chunks && ragInfo.chunks.length > 0 && (
        <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
          {ragInfo.chunks.map((chunk, i) => (
            <div
              key={i}
              className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 border border-border/50"
            >
              <span className="font-semibold text-foreground/60">#{i + 1}</span>{" "}
              {chunk.length > 200 ? chunk.slice(0, 200) + "..." : chunk}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatMessage({ role, content, timestamp, ragInfo }: Readonly<ChatMessageProps>) {
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
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        </div>
        {timestamp && (
          <span className="text-xs text-muted-foreground mt-1">{timestamp}</span>
        )}
        {!isUser && ragInfo && <RagDebugBadge ragInfo={ragInfo} />}
      </div>
    </div>
  );
}
