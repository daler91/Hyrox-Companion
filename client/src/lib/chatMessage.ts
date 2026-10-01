import type { RagInfo } from "@shared/schema";

import { getCurrentTimeString } from "@/lib/dateUtils";

/** One bubble in a coach chat surface. */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  ragInfo?: RagInfo;
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
