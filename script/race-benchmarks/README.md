# Race benchmarks tool

Offline tooling that turns the committed `hyrox_results.csv` (real HYROX singles
results) into the benchmark + ranking artifacts the Race Predictor consumes.

## What it produces

- `shared/raceBenchmarks.generated.ts` — per-cohort median station splits, the
  8-leg run fatigue curve, and median transition (roxzone) time. Consumed by
  `shared/raceSpec.ts`. Small, shared by client + server.
- `server/services/racePrediction/raceRankingData.generated.ts` — per-cohort
  finish-time CDF (p1..p99) for percentile ranking. **Server-only** so the large
  tables never reach the client bundle.

Both are committed. Nothing runs at build or request time.

## Regenerate

```bash
pnpm data:race-benchmarks            # rebuild the two *.generated.ts artifacts
pnpm data:race-benchmarks:backtest   # OLD-seeds vs NEW-data accuracy report
```

The generator reads `./hyrox_results.csv` by default (override with
`--csv=PATH`). A human summary lands in `output/summary.md`; the backtest writes
`output/backtest-report.md`. The `output/` dir is gitignored (regenerable).

## Cohorts & cleaning

- Singles only: `division ∈ {open, pro}`, `gender ∈ {male, female}` — doubles,
  relay, goruck, elite are filtered out.
- Age groups normalized to canonical 5-year bands (`shared/raceConstants.ts`);
  coarse/overlapping/blank labels feed only the division×gender roll-up. An
  age cohort is emitted only with ≥ `MIN_COHORT_SAMPLE` (200) rows; otherwise the
  runtime resolver falls back to division×gender.
- Rows with missing/non-positive splits, splits below the world-class floor, or
  segment splits that don't sum to the stated total are dropped.

## Latest result (≈60.6k clean rows)

The accuracy backtest (80/20 split, cohort-only prediction vs actual finish):

| Model | MAE | mean signed error (bias) |
| --- | ---: | ---: |
| OLD hand-guessed seeds (no transition) | ~906 s (15.1 min) | −12 min |
| NEW data (run curve + real transition) | ~743 s (12.4 min) | −4.3 min |

**~18% MAE improvement**, and the large negative bias (from omitting transition
time entirely) is cut by most of its magnitude. The live predictor improves
further with the athlete's own logged splits and the AI layer — excluded here to
isolate the reference layer.
