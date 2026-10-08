import type { ChatFeedback, ChatSafetyNotice } from "@shared/schema";
import { AlertCircle, Bot, HeartPulse, ImageIcon, RotateCcw, ShieldAlert, ThumbsDown, ThumbsUp, User } from "lucide-react";
import { lazy, memo, Suspense } from "react";

import { RagDebugBadge } from "@/components/RagDebugBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { RagInfo } from "@/hooks/useChatSession";
import type { MessageAttachment, MessageFailure } from "@/lib/chatMessage";
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
  /** The reply's id, for its rating. */
  readonly messageId?: string;
  /** True while this reply streams in (I21). */
  readonly streaming?: boolean;
  /** The athlete's thumbs on the reply. */
  readonly feedback?: ChatFeedback | null;
  /** Offered only on a reply the server saved. Stable across renders, so memo holds. */
  readonly onFeedback?: (messageId: string, feedback: ChatFeedback | null) => void;
  /** The photo an athlete's message carried (I20). */
  readonly attachment?: MessageAttachment;
}

/** A reply as plain text: while the markdown chunk loads, and if it cannot. */
function PlainReply({ content }: { readonly content: string }) {
  return (
    <p className="whitespace-pre-wrap" data-testid="chat-markdown-pending">
      {content}
    </p>
  );
}

/**
 * The markdown stack loads with the first coach reply shown, not with the page
 * (PF8, CODEBASE_ANALYSIS_2026-10-03). A chunk that fails to load (a tab left
 * open across a deploy) shows the reply as plain text rather than reloading
 * the page, which would cut off a reply still streaming in.
 */
const ChatMarkdown = lazy(() =>
  import("@/components/chat/ChatMarkdown").catch(() => ({ default: PlainReply })),
);

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

/**
 * The photo an athlete's message carried (I20). The photo itself is never
 * kept; once the message comes back from the history it shows what the coach
 * read in it, so the athlete can check the coach saw it right.
 */
function PhotoAttachmentNote({ attachment }: { readonly attachment: MessageAttachment }) {
  if (!attachment.reading) {
    return (
      <p className="mt-2 flex items-center gap-1 text-xs opacity-90" data-testid="message-photo">
        <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
        Photo attached
      </p>
    );
  }
  return (
    <details className="mt-2 text-xs opacity-90" data-testid="message-photo">
      <summary className="cursor-pointer">
        <ImageIcon className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />
        Photo attached: what the coach read
      </summary>
      <p className="mt-1 whitespace-pre-wrap">{attachment.reading}</p>
    </details>
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

const FEEDBACK_OPTIONS = [
  { value: "up", label: "Helpful", Icon: ThumbsUp },
  { value: "down", label: "Not helpful", Icon: ThumbsDown },
] as const;

interface ReplyFeedbackProps {
  readonly messageId: string;
  readonly feedback?: ChatFeedback | null;
  readonly onFeedback: (messageId: string, feedback: ChatFeedback | null) => void;
}

/** Thumbs on a coach reply (I23); pressing the chosen one again clears it. */
function ReplyFeedback({ messageId, feedback, onFeedback }: ReplyFeedbackProps) {
  return (
    <div className="flex items-center" data-testid="message-feedback">
      {FEEDBACK_OPTIONS.map(({ value, label, Icon }) => {
        const selected = feedback === value;
        return (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="icon"
            className={cn("h-11 w-11 text-muted-foreground md:h-7 md:w-7", selected && "text-foreground")}
            aria-label={label}
            aria-pressed={selected}
            onClick={() => {
              onFeedback(messageId, selected ? null : value);
            }}
            data-testid={`button-feedback-${value}`}
          >
            <Icon className={cn("h-3.5 w-3.5", selected && "fill-current")} aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}

// ⚡ Perf: React.memo prevents re-rendering unchanged messages during streaming.
// During AI response streaming, setMessages fires on every token chunk, triggering
// a re-render of the entire message list. Without memo, all N messages re-render
// per chunk; with memo, only the actively streaming message re-renders (~N-1 fewer
// re-renders per chunk). Props are primitives or references that stay stable
// for an unchanged message (onRetry is passed only to a failed reply, and
// onFeedback is one stable callback), so the default shallow comparison works
// correctly.
export const ChatMessage = memo(function ChatMessage({
  role,
  content,
  timestamp,
  ragInfo,
  safetyNotice,
  failure,
  onRetry,
  messageId,
  streaming = false,
  feedback,
  onFeedback,
  attachment,
}: Readonly<ChatMessageProps>) {
  const isUser = role === "user";
  // A reply that failed before any text arrived is just its failure note.
  const showText = content !== "" || !failure;
  const canRate = !isUser && !failure && messageId !== undefined && onFeedback !== undefined;

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
            <>
              <p className="text-sm whitespace-pre-wrap">{content}</p>
              {attachment && <PhotoAttachmentNote attachment={attachment} />}
            </>
          ) : (
            <>
              {safetyNotice && <SafetyNoticeBanner notice={safetyNotice} />}
              {showText && (
                // The conversation is a polite live region, and a streaming
                // reply changes on every frame (I21). While it streams its text
                // is busy and out of the region; once complete it mounts as a
                // new node, so a screen reader reads the whole reply once.
                <div
                  key={streaming ? "streaming" : "complete"}
                  aria-busy={streaming || undefined}
                  aria-live={streaming ? "off" : undefined}
                  className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2"
                >
                  {/* Sanitized markdown (C2): see ChatMarkdown. */}
                  <Suspense fallback={<PlainReply content={content} />}>
                    <ChatMarkdown content={content} />
                  </Suspense>
                </div>
              )}
              {failure && (
                <ReplyFailureNote message={failure.message} onRetry={onRetry} afterText={content !== ""} />
              )}
            </>
          )}
        </div>
        {(timestamp || canRate) && (
          <div className="mt-1 flex items-center gap-1">
            {timestamp && (
              <span className="text-xs text-muted-foreground" aria-label={`sent ${timestamp}`}>
                {timestamp}
              </span>
            )}
            {canRate && <ReplyFeedback messageId={messageId} feedback={feedback} onFeedback={onFeedback} />}
          </div>
        )}
        {!isUser && ragInfo && <RagDebugBadge ragInfo={ragInfo} />}
      </div>
    </div>
  );
});
ChatMessage.displayName = "ChatMessage";
