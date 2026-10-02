import type { ChatFactProposal, ChatFeedback, ChatMessageKind, ChatSafetyNotice, RagInfo } from "@shared/schema";

import type { PlanProposalView } from "@/lib/api";
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
    /**
     * Its id: the resend reuses it, so the server saves the turn once however
     * many attempts it takes, and the old bubble is replaced rather than duplicated.
     */
    userMessageId: string;
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
  /** Fixed safety copy the server attached to this reply (aiSafety.buildChatSafetyNotice). */
  safetyNotice?: ChatSafetyNotice;
  /** The plan proposal this reply carried; its card shows the proposal's current status. */
  proposal?: PlanProposalView;
  /** A lasting fact the coach offered to put on the athlete card, and the athlete's answer (I5b). */
  factProposal?: ChatFactProposal;
  /**
   * What the saved row is. `summary` is the note the coach carried into a new
   * session after a break: shown as a divider, not as something the coach said.
   */
  kind?: ChatMessageKind;
  /** When it was sent, for the date separators (the welcome message has none). */
  sentAtMs?: number;
  failure?: MessageFailure;
  /**
   * A coach reply the server saved under this id, so the athlete can rate it:
   * one loaded from the history, or one that finished arriving here (I23).
   */
  rateable?: boolean;
  /** The athlete's thumbs on the reply, when they gave one. */
  feedback?: ChatFeedback | null;
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
  const now = Date.now();
  return { id, role, content, timestamp: getCurrentTimeString(), createdAtMs: now, sentAtMs: now };
}
