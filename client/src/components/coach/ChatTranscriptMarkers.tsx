import { ChevronDown, History } from "lucide-react";

/** Where the chat moves to a new day; the bubbles carry only the time. */
export function ChatDaySeparator({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center gap-2 py-1" data-testid="chat-day-separator">
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

/**
 * Where a new session began after a break: the coach no longer reads the
 * turns above, only this note of them, which the athlete can open.
 */
export function SessionSummaryNote({ summary }: { readonly summary: string }) {
  return (
    <details
      className="group rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
      data-testid="chat-session-summary"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [&::-webkit-details-marker]:hidden">
        <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>New conversation — the coach carried over a note of the earlier one</span>
        <ChevronDown className="ml-auto h-3 w-3 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <p className="mt-2 whitespace-pre-wrap text-foreground/80">{summary}</p>
    </details>
  );
}
