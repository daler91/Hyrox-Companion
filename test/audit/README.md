# Characterisation tests for the calculation audit

These files pin the **current, wrong** behaviour of the findings in
[`docs/CALCULATION_AUDIT_2026-08-20.md`](../../docs/CALCULATION_AUDIT_2026-08-20.md).
They are Phase 0 of that document's plan of attack.

## Why these exist

None of the audit findings crash. They render plausible, confident, wrong numbers, so there is
no failing signal today — and several of the repo's existing tests actively assert the buggy
values (`server/services/workoutService.test.ts:313` asserts the 60× seconds-into-a-minutes-column
passthrough; the MAF suite asserts the age-65 ceiling cliff). The suite is green _because_ the bugs
are baked into its expectations.

That makes "fix the bug" dangerous without a net: there is nothing to tell a future contributor
whether a number changed on purpose. These tests are that net.

## The convention

Each test asserts what the code does **now**, not what it should do. Every one carries a header
naming its finding ID, the current value, and the intended value:

```ts
/**
 * C2 — MAF ceiling falls 11 bpm on the 65th birthday.
 * CURRENT:  age 65 → 110 bpm
 * INTENDED: age 65 → >= 121 bpm (no age boundary may reduce a ceiling)
 * RETIRE:   when C2 is fixed this test fails. Replace the assertion with the
 *           INTENDED behaviour and delete the `[BUG]` marker from the name.
 */
```

Test names are prefixed `[BUG C2]` so a red run points straight at the register entry.

Alongside the characterisation tests, a few **intent** tests state the invariant the code should
satisfy, wrapped in `it.fails()`. Those pass today _because_ the assertion inside them fails. When
the bug is fixed, vitest reports "expected test to fail, but it passed" — which is the prompt to
drop the `.fails` and keep the test as a permanent guard.

## Working with them

- **Green today is correct.** A red run here means either a fix landed (good — retire the test) or
  a regression changed a number nobody intended to touch (bad — read the header).
- **Do not "fix" a failing test by updating its expected value.** The expected value _is_ the bug
  report. Update it only together with the code change that made it stale, and flip the header.
- These are deliberately narrow: no mocks, no DB. Every fixture is a literal, and every expected
  number was produced by running the shipping module.

## Coverage

Phase 0 currently covers all seven C-tier findings. H-tier findings are not yet covered; see the
register for the full list.
