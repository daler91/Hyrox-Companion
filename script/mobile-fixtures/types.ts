/**
 * A golden-fixture suite: a TypeScript function from shared/ run over fixed
 * inputs. The outputs pin the behaviour a Kotlin port must reproduce exactly
 * (mobile/core/src/commonTest/.../fixtures, docs/mobile-shared-logic.md).
 *
 * Inputs and outputs are JSON. `undefined` does not survive JSON: return
 * null (or leave the key out) consistently, and have the port do the same.
 * NaN and ±Infinity are written as the strings "NaN", "Infinity" and
 * "-Infinity".
 */
export interface FixtureSuite<I = unknown, O = unknown> {
  /** `<module>.<function>`, e.g. `unitConversion.convertWeight`. Also the file name. */
  readonly name: string;
  /** What the cases pin, in a sentence; written into the fixture file. */
  readonly description: string;
  readonly run: (input: I) => O;
  readonly cases: readonly I[];
}

/** Helper that keeps each suite's input and output types checked. */
export function suite<I, O>(definition: FixtureSuite<I, O>): FixtureSuite<I, O> {
  return definition;
}
