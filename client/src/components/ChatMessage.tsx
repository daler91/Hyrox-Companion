import type { ChatSafetyNotice } from "@shared/schema";
import { AlertCircle, Bot, HeartPulse, RotateCcw, ShieldAlert, User } from "lucide-react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

import { RagDebugBadge } from "@/components/RagDebugBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { RagInfo } from "@/hooks/useChatSession";
import type { MessageFailure } from "@/lib/chatMessage";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly timestamp?: string;
  readonly ragInfo?: RagInfo;
  /** Fixed safety copy shown above the reply, whatever the model wrote. */
  readonly safetyNotice?: ChatSafetyNotice;
  /** Set on a reply that did not complete. */
  readonly failure?: MessageFailure;
  /** Offered only on a failed reply that can be sent again. */
  readonly onRetry?: () => void;
}

/**
 * The urgent escalation is an alert, so it is announced as soon as it lands
 * (it arrives before any reply text); the medication disclaimer is a note.
 */
function SafetyNoticeBanner({ notice }: { readonly notice: ChatSafetyNotice }) {
  const urgent = notice.level === "urgent";
  const Icon = urgent ? ShieldAlert : HeartPulse;
  return (
    <div
      role={urgent ? "alert" : "note"}
      className={cn(
        "mb-2 flex gap-2 rounded-md border p-2 text-sm",
        urgent
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
      )}
      data-testid={`safety-notice-${notice.level}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{notice.message}</p>
    </div>
  );
}

interface ReplyFailureNoteProps {
  readonly message: string;
  readonly onRetry?: () => void;
  /** The reply has text above the note, so set the note apart from it. */
  readonly afterText: boolean;
}

function ReplyFailureNote({ message, onRetry, afterText }: ReplyFailureNoteProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-sm text-muted-foreground",
        afterText && "mt-2 border-t pt-2 text-xs",
      )}
      data-testid="message-failure"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-8"
          onClick={onRetry}
          data-testid="button-retry-message"
        >
          <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}

// ⚡ Perf: React.memo prevents re-rendering unchanged messages during streaming.
// During AI response streaming, setMessages fires on every token chunk, triggering
// a re-render of the entire message list. Without memo, all N messages re-render
// per chunk; with memo, only the actively streaming message re-renders (~N-1 fewer
// re-renders per chunk). Props are primitives or references that stay stable
// for an unchanged message (onRetry is passed only to a failed reply), so the
// default shallow comparison works correctly.
export const ChatMessage = memo(function ChatMessage({
  role,
  content,
  timestamp,
  ragInfo,
  safetyNotice,
  failure,
  onRetry,
}: Readonly<ChatMessageProps>) {
  const isUser = role === "user";
  // A reply that failed before any text arrived is just its failure note.
  const showText = content !== "" || !failure;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`} data-testid={`message-${role}`}>
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-secondary"}>
          {isUser ? <User className="h-4 w-4" aria-hidden="true" /> : <Bot className="h-4 w-4" aria-hidden="true" />}
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
            <>
              {safetyNotice && <SafetyNoticeBanner notice={safetyNotice} />}
              {showText && (
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2">
                  {/* AI output is rendered as markdown; rehype-sanitize strips
                      script tags, event handlers, and javascript:/data: URLs so a
                      compromised provider or prompt-injection attempt can't run
                      arbitrary JS in the user's session (C2). */}
                  <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
                </div>
              )}
              {failure && (
                <ReplyFailureNote message={failure.message} onRetry={onRetry} afterText={content !== ""} />
              )}
            </>
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
