# Regression guards for the calculation audit

`criticals.audit.test.ts` guards the fixes for all seven C-tier findings (C1–C7) of
[`docs/CALCULATION_AUDIT_2026-08-20.md`](../../docs/CALCULATION_AUDIT_2026-08-20.md), plus H1,
which shares C7's root cause. Every finding they cover is **fixed**: each `describe` block is
marked `(FIXED)` and the tests are named `[FIXED C4]`, `[FIXED H1]` and so on. A red run here
means a regression changed one of those numbers.

## How they started

They began as Phase 0 of that document's plan of attack: characterisation tests pinning the
**current, wrong** behaviour. None of the audit findings crashed — they rendered plausible,
confident, wrong numbers — and several existing tests asserted the buggy values (a
`workoutService` test pinned the 60× seconds-into-a-minutes-column passthrough; the MAF suite
pinned the age-65 ceiling cliff). The suite was green _because_ the bugs were baked into its
expectations, so fixing them needed a net that said whether a number changed on purpose.

The convention was: each test asserted what the code did then, under a header naming the finding,
the current value and the intended value, with a `[BUG C2]`-style name prefix; a few **intent**
tests stated the invariant the code should satisfy inside `it.fails()`. Fixing a finding meant
flipping the header, replacing the assertion with the intended behaviour, renaming the test
`[FIXED …]`, and dropping `.fails` — which is the state every test here is in now. Some headers
still record the old CURRENT value for provenance, and the `workoutService` test that pinned the
C7 passthrough is now marked `INVERTED (audit C7)`.

## Working with them

- **Do not "fix" a failing test by updating its expected value.** Each expected value is the
  intended behaviour of a fixed finding; change it only together with a deliberate change to that
  behaviour, and say so in the header.
- These are deliberately narrow: no mocks, no DB. Every fixture is a literal, and every expected
  number was produced by running the shipping module.
- A new calculation finding can reuse the convention above: pin the current value first, then
  flip it in the commit that fixes it.

## Coverage

All seven C-tier findings and H1. The remaining H-tier findings are not covered here; see the
register in the audit document for the full list.
