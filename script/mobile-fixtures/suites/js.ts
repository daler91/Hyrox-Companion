/**
 * JavaScript number behaviour the Kotlin helpers in
 * mobile/core/.../js/JsMath.kt must match: Math.round and toFixed. Every
 * port that rounds relies on these, so they are pinned first.
 */
import { suite } from "../types";

/** Deterministic pseudo-random doubles (a fixed LCG), so the fixture never changes on its own. */
function seeded(count: number, scale: number, seed: number): number[] {
  let state = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const unit = state / 2 ** 32;
    out.push((unit - 0.5) * 2 * scale);
  }
  return out;
}

const EDGES = [
  0, -0, 0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 0.49999999999999994, -0.49999999999999994, 1.005, 1.045, 2.675, 1.255,
  0.1 + 0.2, 123.456, 999.9999, 4.35, 8.345, 1.45, -1.45, -1.005, 0.0001, -0.0001, 1e-7, 5e-7, 12345678.5, 99.995,
  0.125, 0.375, -0.125, 7.0000000001, 1 / 3, 2 / 3, 1e15 + 0.5, 4503599627370495.5, 2 ** 52, 1e20,
];

/** Doubles from seeded random bit patterns: every exponent range, subnormals included. */
function seededBitPatterns(count: number, seed: number): number[] {
  let state = seed >>> 0;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  const view = new DataView(new ArrayBuffer(8));
  const out: number[] = [];
  while (out.length < count) {
    view.setUint32(0, next());
    view.setUint32(4, next());
    const x = view.getFloat64(0);
    if (Number.isFinite(x)) out.push(x);
  }
  return out;
}

/** Every UTF-16 unit JS trim() and Kotlin trim() disagree on, and the common whitespace. */
const TRIM_CHARS = [
  "\t", "\n", "\v", "\f", "\r", " ", "\u00a0", "\u1680", "\u2000", "\u2005", "\u200a", "\u2028", "\u2029",
  "\u202f", "\u205f", "\u3000", "\ufeff", "\u001c", "\u001d", "\u001e", "\u001f", "\u0085", "\u180e", "\u200b",
];

export const jsSuites = [
  suite({
    name: "js.mathRound",
    description: "Math.round: nearest integer, halves towards +Infinity.",
    run: (x: number) => Math.round(x),
    cases: [...EDGES, ...seeded(200, 1000, 7), ...seeded(50, 3, 11)],
  }),
  suite({
    name: "js.numberToString",
    description: "String(x) for a number: shortest round-trip digits, exponent outside 1e-6 <= |x| < 1e21.",
    run: (x: number) => String(x),
    cases: [
      ...EDGES,
      Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, Number.EPSILON, 1e-6, 9.999999e-7, 1e-7, 1e21, 9.99e20,
      123456789012345680000, 0.000001234, 5e-324, 1.7976931348623157e308, 100, 1e7, 1234.5, 0.1, -0.1,
      ...seeded(100, 1e6, 17),
      ...seededBitPatterns(300, 23),
    ],
  }),
  suite({
    name: "js.trim",
    description: "String.prototype.trim: ECMAScript WhiteSpace and LineTerminator, which differ from Kotlin's trim().",
    run: (text: string) => text.trim(),
    cases: [
      "", "  kg ", "kg", "\u00a0kg\u00a0", ...TRIM_CHARS.map((c) => `${c}lbs${c}`), ...TRIM_CHARS.map((c) => `${c}`),
      TRIM_CHARS.join(""), `${TRIM_CHARS.join("")}mid dle${TRIM_CHARS.join("")}`,
    ],
  }),
  suite({
    name: "js.toFixed",
    description: "Number.prototype.toFixed over the exact binary value, for |x| < 1e21.",
    run: ([x, digits]: [number, number]) => x.toFixed(digits),
    cases: [
      ...EDGES.flatMap((x) => [0, 1, 2, 3].map((d) => [x, d] as [number, number])),
      ...seeded(150, 500, 3).map((x, i) => [x, i % 5] as [number, number]),
      [0.000001, 10],
      [123.456, 20],
      [1e20, 2],
    ],
  }),
];
