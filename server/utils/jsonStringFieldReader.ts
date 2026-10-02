/**
 * Reads one string field off the outermost object of a JSON document while the
 * document is still streaming in (AI coach chat review, I11: a plan proposal's
 * summary reaches the athlete as the model writes it, not once the whole
 * proposal has been parsed).
 *
 * Feed the reader each chunk as it arrives. It returns the field's characters
 * that chunk completed, with escapes resolved, or "" when the chunk held none.
 * Only the outermost object's field counts — the same name on a nested object,
 * or written inside another string, is not it — and only its first value.
 * Anything before the opening brace (a code fence) or after the closing one is
 * ignored.
 */

const SIMPLE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["\\", "\\"],
  ["/", "/"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
]);

/** What the open string is: a key of the outermost object, the field's value, or neither. */
type StringRole = "key" | "value" | "other";

interface ReaderState {
  depth: number;
  inString: boolean;
  escaping: boolean;
  /** The hex digits of a \u escape so far, or null outside one. */
  hex: string | null;
  role: StringRole;
  /** The outermost key being read. */
  key: string;
  /** On the outermost object: true after `{` or `,`, when the next string is a key. */
  expectKey: boolean;
  /** The outermost key the next value belongs to. */
  valueOf: string | null;
  /** A high surrogate from a \u escape, held until its low half arrives. */
  held: string;
  done: boolean;
}

function isHighSurrogate(unit: string): boolean {
  if (unit.length !== 1) return false;
  // One code unit: a lone surrogate reads as itself.
  const code = unit.codePointAt(0);
  return code !== undefined && code >= 0xD8_00 && code <= 0xDB_FF;
}

/** One decoded character of the open string. */
function pushChar(state: ReaderState, char: string, out: string[]): void {
  if (state.role === "key") {
    state.key += char;
    return;
  }
  if (state.role !== "value") return;
  // A \u-escaped pair arrives one half at a time: keep them together.
  if (isHighSurrogate(char)) {
    state.held += char;
    return;
  }
  out.push(state.held + char);
  state.held = "";
}

/** The character after a backslash, or one digit of \uXXXX: the decoded character once complete. */
function readEscape(state: ReaderState, char: string): string | null {
  if (state.hex !== null) {
    state.hex += char;
    if (state.hex.length < 4) return null;
    const code = Number.parseInt(state.hex, 16);
    // Malformed digits read as the replacement character; the full parse rejects the document anyway.
    const decoded = Number.isNaN(code) ? "\uFFFD" : String.fromCodePoint(code);
    state.hex = null;
    state.escaping = false;
    return decoded;
  }
  if (char === "u") {
    state.hex = "";
    return null;
  }
  state.escaping = false;
  return SIMPLE_ESCAPES.get(char) ?? char;
}

function closeString(state: ReaderState, out: string[]): void {
  state.inString = false;
  if (state.role === "value") {
    if (state.held) out.push(state.held);
    state.held = "";
    state.done = true;
  } else if (state.role === "key") {
    state.valueOf = state.key;
    state.expectKey = false;
  }
  state.role = "other";
}

function readStringChar(state: ReaderState, char: string, out: string[]): void {
  if (state.escaping) {
    const decoded = readEscape(state, char);
    if (decoded !== null) pushChar(state, decoded, out);
    return;
  }
  if (char === "\\") {
    state.escaping = true;
    return;
  }
  if (char === '"') {
    closeString(state, out);
    return;
  }
  pushChar(state, char, out);
}

function openString(state: ReaderState, field: string): void {
  state.inString = true;
  if (state.depth !== 1) {
    state.role = "other";
  } else if (state.expectKey) {
    state.role = "key";
    state.key = "";
  } else {
    state.role = state.valueOf === field ? "value" : "other";
  }
}

function readStructuralChar(state: ReaderState, char: string, field: string): void {
  switch (char) {
    case "{":
    case "[":
      state.depth += 1;
      if (state.depth === 1) state.expectKey = char === "{";
      break;
    case "}":
    case "]":
      state.depth -= 1;
      // The outermost object closed: the field was absent, or already read.
      if (state.depth <= 0) state.done = true;
      break;
    case ",":
      if (state.depth === 1) {
        state.expectKey = true;
        state.valueOf = null;
      }
      break;
    case '"':
      openString(state, field);
      break;
    default:
      break;
  }
}

export function createJsonStringFieldReader(field: string): (chunk: string) => string {
  const state: ReaderState = {
    depth: 0,
    inString: false,
    escaping: false,
    hex: null,
    role: "other",
    key: "",
    expectKey: false,
    valueOf: null,
    held: "",
    done: false,
  };
  return (chunk) => {
    const out: string[] = [];
    for (const char of chunk) {
      if (state.done) break;
      if (state.inString) readStringChar(state, char, out);
      else readStructuralChar(state, char, field);
    }
    return out.join("");
  };
}
