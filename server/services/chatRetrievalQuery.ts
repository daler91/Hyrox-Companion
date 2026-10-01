import type { ChatMessage } from "@shared/schema";

/**
 * What a chat turn searches the athlete's coaching materials for.
 *
 * The search query was the raw new message: "thanks!" paid for an embedding
 * and six excerpts, and a follow-up such as "what about for the sled?"
 * searched for exactly that phrase, not for what the conversation was about.
 */

// One emoji code point: a pictograph, or a skin-tone modifier, variation
// selector or joiner composing one (not \p{Emoji_Component}, which also covers
// digits). An alternation, because a character class would split the composed
// sequences.
const EMOJI = String.raw`(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D})`;
/** A message that is only thanks, acknowledgement or emoji. */
const SOCIAL_MESSAGE = new RegExp(
  String.raw`^(?:(?:thanks|thank you|thx|ty|cheers|cool|nice|great|awesome|perfect|amazing|brilliant|ok(?:ay)?|got it|sounds good|will do|noted|lol|haha|legend|appreciate it)(?:[\s,.!]|${EMOJI})*)+$`,
  "iu",
);
const EMOJI_ONLY = new RegExp(String.raw`^(?:\s|${EMOJI})+$`, "u");
const SOCIAL_MAX_CHARS = 60;

/** A follow-up leans on the turn before it: short, or opening with a pronoun or connector. */
const FOLLOW_UP_OPENER = /^(?:and|but|so|also|what about|how about|what if|why|it|that|this|those|these|they|them|same)\b/i;
const FOLLOW_UP_MAX_WORDS = 6;
const PREVIOUS_TURN_MAX_CHARS = 300;

export function isSocialMessage(message: string): boolean {
  const text = message.trim();
  if (text.length > SOCIAL_MAX_CHARS) return false;
  return text === "" || SOCIAL_MESSAGE.test(text) || EMOJI_ONLY.test(text);
}

function isFollowUp(message: string): boolean {
  const text = message.trim();
  return text.split(/\s+/).length <= FOLLOW_UP_MAX_WORDS || FOLLOW_UP_OPENER.test(text);
}

/**
 * The retrieval query for a chat turn: null when there is nothing worth
 * retrieving for, the previous athlete turn plus the message for a
 * follow-up, else the message itself.
 */
export function chatRetrievalQuery(
  message: string,
  history: Pick<ChatMessage, "role" | "content">[],
): string | null {
  if (isSocialMessage(message)) return null;
  if (!isFollowUp(message)) return message;
  const previous = history.findLast((turn) => turn.role === "user")?.content.trim();
  return previous ? `${previous.slice(-PREVIOUS_TURN_MAX_CHARS)}\n${message}` : message;
}
