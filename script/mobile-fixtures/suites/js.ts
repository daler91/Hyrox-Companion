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

export const jsSuites = [
  suite({
    name: "js.mathRound",
    description: "Math.round: nearest integer, halves towards +Infinity.",
    run: (x: number) => Math.round(x),
    cases: [...EDGES, ...seeded(200, 1000, 7), ...seeded(50, 3, 11)],
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
