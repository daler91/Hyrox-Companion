import { describe, expect, it } from "vitest";

import { createJsonStringFieldReader } from "./jsonStringFieldReader";

/** Feed `json` to a fresh reader in pieces of `size` characters; the field's text, and the pieces it came in. */
function readInPieces(json: string, size: number, field = "summaryMessage") {
  const read = createJsonStringFieldReader(field);
  const pieces: string[] = [];
  for (let start = 0; start < json.length; start += size) pieces.push(read(json.slice(start, start + size)));
  return { text: pieces.join(""), pieces };
}

const PROPOSAL = JSON.stringify({
  summaryMessage: 'I moved your long run to Saturday — "easy" pace, and a rest day after. ✅',
  changes: [{ planDayId: "day-1", rationale: "Saturday leaves a rest day before the race." }],
});

describe("createJsonStringFieldReader", () => {
  it("reads the field whole, or a character at a time", () => {
    const expected = 'I moved your long run to Saturday — "easy" pace, and a rest day after. ✅';
    expect(readInPieces(PROPOSAL, PROPOSAL.length).text).toBe(expected);
    expect(readInPieces(PROPOSAL, 1).text).toBe(expected);
    expect(readInPieces(PROPOSAL, 7).text).toBe(expected);
  });

  it("hands each piece over as it arrives, not at the end", () => {
    const { pieces } = readInPieces(PROPOSAL, 10);
    expect(pieces.filter(Boolean).length).toBeGreaterThan(3);
  });

  it("resolves escapes, keeping a \\u-escaped pair together across chunks", () => {
    const json = String.raw`{"summaryMessage": "Line one\nLine \"two\" \\ café 🏃 done"}`;
    for (const size of [1, 3, json.length]) {
      const { text, pieces } = readInPieces(json, size);
      expect(text).toBe('Line one\nLine "two" \\ café 🏃 done');
      // No piece ends half a pair: each is valid text on its own.
      for (const piece of pieces) expect(piece).toBe(piece.toWellFormed());
    }
  });

  it("reads the outermost field only, wherever it sits", () => {
    const json = JSON.stringify({
      changes: [{ summaryMessage: "nested, not it", rationale: 'says "summaryMessage": "not it either"' }],
      summaryMessage: "the real one",
    });
    expect(readInPieces(json, 5).text).toBe("the real one");
  });

  it("looks past a code fence around the object", () => {
    const fenced = ["```json", PROPOSAL, "```"].join("\n");
    expect(readInPieces(fenced, 4).text).toBe('I moved your long run to Saturday — "easy" pace, and a rest day after. ✅');
  });

  it("reads nothing when the field is missing or not a string, and stops after the first value", () => {
    expect(readInPieces(JSON.stringify({ changes: [] }), 3).text).toBe("");
    expect(readInPieces(JSON.stringify({ summaryMessage: null, changes: [] }), 3).text).toBe("");

    const read = createJsonStringFieldReader("summaryMessage");
    expect(read('{"summaryMessage": "first", ')).toBe("first");
    expect(read('"summaryMessage": "second"}')).toBe("");
  });
});
