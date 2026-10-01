import type { RagInfo } from "@shared/schema";

import { getCurrentTimeString } from "@/lib/dateUtils";

/**
 * A reply that did not complete. UI-only: it is never saved, and never sent
 * to the model as part of the conversation.
 */
export interface MessageFailure {
  /** What the athlete reads on the reply. */
  message: string;
  /** Present when sending the same message again could succeed. */
  retry?: {
    /** The athlete's message, to send again. */
    content: string;
    /** The bubble holding it, removed on retry so the resend doesn't duplicate it. */
    userMessageId: string;
    /** The server accepted that turn and the client saved it, so a resend must not save it twice. */
    userSaved: boolean;
  };
}

/** One bubble in a coach chat surface. */
export interface Message {
  id: string;
  role: "user" | "assistant";
  /** What was said. Empty on a reply that failed before any text arrived. */
  content: string;
  timestamp: string;
  ragInfo?: RagInfo;
  failure?: MessageFailure;
  /**
   * Epoch ms the Coach panel sorts by when it merges the chat hook's messages
   * with its own local ones (suggestion replies, plan-proposal confirmations).
   * Hydrated history and the welcome message carry 0: they predate anything
   * created in this session. Required, so a message built without a real stamp
   * is a type error rather than a reply that sorts as 0 and renders above the
   * question that produced it.
   */
  createdAtMs: number;
}

/**
 * A message created on this client, now. Every locally built bubble goes
 * through here so it carries the sort stamp and a collision-free id —
 * `Date.now().toString()` ids collide for two messages built in the same
 * millisecond, and the panel de-duplicates by id.
 */
export function createLocalMessage(
  role: Message["role"],
  content: string,
  id: string = crypto.randomUUID(),
): Message {
  return { id, role, content, timestamp: getCurrentTimeString(), createdAtMs: Date.now() };
}
