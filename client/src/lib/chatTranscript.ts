import type { Message } from "@/lib/chatMessage";

/**
 * How a chat surface lays out its messages (AI coach chat review, I2): a
 * separator wherever the day changes — the bubbles show only the time — and
 * the note the coach carried into a new session as a divider of its own.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "Today", "Yesterday", or the date: "Tue, 29 Sep", with the year when it isn't this one. */
export function chatDayLabel(sentAtMs: number, now: Date = new Date()): string {
  const day = new Date(sentAtMs);
  // Rounded, so a day that DST makes 23 or 25 hours long still counts as one.
  const daysAgo = Math.round((startOfLocalDay(now) - startOfLocalDay(day)) / DAY_MS);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export type TranscriptItem =
  | { type: "day"; key: string; label: string }
  | { type: "summary"; message: Message }
  | { type: "message"; message: Message };

/** The messages in order, with a day separator ahead of each day's first message. */
export function buildTranscript(messages: readonly Message[], now: Date = new Date()): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let lastDay: string | undefined;
  for (const message of messages) {
    if (message.sentAtMs !== undefined) {
      const day = new Date(message.sentAtMs).toDateString();
      if (day !== lastDay) {
        items.push({ type: "day", key: `day-${items.length}-${day}`, label: chatDayLabel(message.sentAtMs, now) });
        lastDay = day;
      }
    }
    items.push({ type: message.kind === "summary" ? "summary" : "message", message });
  }
  return items;
}
