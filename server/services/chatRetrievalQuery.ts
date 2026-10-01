import type { ChatMessage } from "@shared/schema";

/**
 * What a chat turn searches the athlete's coaching materials for.
 *
 * The search query was the raw new message: "thanks!" paid for an embedding
 * and six excerpts, and a follow-up such as "what about for the sled?"
 * searched for exactly that phrase, not for what the conversation was about.
 */

// An emoji code point, in both patterns below: a pictograph, or a skin-tone
// modifier, variation selector or joiner composing one (not
// \p{Emoji_Component}, which also covers digits). An alternation, because a
// character class would split the composed sequences.
const EMOJI_ONLY = /^(?:\s|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D})+$/u;
/** What may sit between the phrases of a thank-you: spaces, light punctuation, emoji. */
const SOCIAL_FILLER = /^(?:[\s,.!]|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D})+/u;
/** Thanks and acknowledgements, longest first so "okay" isn't read as "ok" + "ay". */
const SOCIAL_PHRASES = [
  "appreciate it", "sounds good", "thank you", "brilliant", "awesome", "perfect", "amazing", "will do",
  "cheers", "legend", "thanks", "got it", "noted", "great", "okay", "cool", "nice", "haha", "thx", "lol",
  "ok", "ty",
];
const SOCIAL_MAX_CHARS = 60;

/** A message made only of thanks and acknowledgements, with the filler between them. */
function isThankYou(message: string): boolean {
  let text = message.toLowerCase();
  while (text !== "") {
    const phrase = SOCIAL_PHRASES.find((candidate) => text.startsWith(candidate));
    if (phrase === undefined) return false;
    text = text.slice(phrase.length).replace(SOCIAL_FILLER, "");
  }
  return true;
}

/** A follow-up leans on the turn before it: short, or opening with a pronoun or connector. */
const FOLLOW_UP_OPENER = /^(?:and|but|so|also|what about|how about|what if|why|it|that|this|those|these|they|them|same)\b/i;
const FOLLOW_UP_MAX_WORDS = 6;
const PREVIOUS_TURN_MAX_CHARS = 300;

export function isSocialMessage(message: string): boolean {
  const text = message.trim();
  if (text.length > SOCIAL_MAX_CHARS) return false;
  return text === "" || EMOJI_ONLY.test(text) || isThankYou(text);
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
