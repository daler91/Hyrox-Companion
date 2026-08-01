# React 19 Upgrade Plan — `react@18.3.1` → `react@19.2.8`

Status: **planned** — codebase and dependency audit completed 2026-08-01 against `main`.
All version/peer-range facts below were verified live against the npm registry on that date.

## Purpose

Move the client from React 18.3.1 to the latest stable React 19.x (19.2.8 at audit
time), keep every CI gate green, and position the app to adopt React 19 features
(Actions, `use()`, document metadata, React Compiler) incrementally afterwards.

## Scope

- `react`, `react-dom`, `@types/react`, `@types/react-dom` major bumps + lockfile.
- The three type annotations that break under `@types/react@19` (see §3).
- Wiring Sentry into the new React 19 root error-handler options.
- Doc updates for hardcoded "React 18" references.

## Non-goals

- **No server changes.** The server bundle imports no React (verified: zero React
  imports under `server/`; the esbuild bundle externalizes all packages).
- **No React Compiler adoption** in the upgrade PR (follow-up, §6.4).
- **No `<StrictMode>` introduction** in the upgrade PR (follow-up, §6.2 — the app
  renders no StrictMode today; adding it alongside the major bump would conflate
  two sources of behavior change).
- **No forwardRef → ref-as-prop rewrite** of the vendored shadcn/ui primitives
  (follow-up, §6.5; `forwardRef` remains fully supported throughout 19.x, and
  the ui/ primitives are vendor code — realign with upstream shadcn, which
  dropped `forwardRef` in its React 19 refactor, at a future re-vendor).
- **No new-API adoption** (Actions, `use()`, `<Activity>`, metadata hoisting) in
  the upgrade PR — menu of options in §6.5.

---

## 1. Audit summary — why this is a small upgrade

The codebase was audited file-by-file for every React 19 breaking change
(2026-08-01). Result: **zero removed-API usage anywhere in first-party code.**

| React 19 removal / break | Usage found |
| --- | --- |
| `ReactDOM.render` / `hydrate` / `unmountComponentAtNode` / `findDOMNode` | 0 — `client/src/main.tsx:44` already uses `createRoot` |
| `react-dom/test-utils` (incl. `act`) | 0 — all 257 `act()` calls across 38 test files import from `@testing-library/react` |
| `react-test-renderer` | 0 (not installed) |
| String refs / `this.refs` | 0 |
| Legacy Context (`contextTypes` / `getChildContext`) | 0 |
| `propTypes` / `defaultProps` on function components | 0 (`prop-types` not a dependency; grep hits are local test variables named `defaultProps`) |
| Class components | 0 first-party (only error boundary is `Sentry.ErrorBoundary`; `FallbackErrorBoundary` is a function component) |
| `element.ref` access | 0 |
| `react-dom/server` / SSR / hydration | 0 — pure CSR SPA |
| UMD builds | n/a — Vite ESM bundle |
| Old JSX transform | n/a — Vite automatic runtime (`react()` plugin, default options); tsconfig `"jsx": "preserve"` |
| Global `JSX.*` namespace (types) | 0 |
| `useRef()` without argument (types) | 0 — all 93 call sites pass an initial value |
| Ref callbacks with implicit returns (types) | 0 — none of the 80 `ref={...}` sites is an inline callback (they pass identifiers, conditional identifiers, or library callbacks); the one hand-rolled composed ref (`TimelineDateGroup.tsx`) uses a void block body |
| `useReducer` explicit generics (types) | 0 |

Because the app is already on 18.3.1 (which warns on every removed API) and the
dev console is clean, the removed-API class of breaks is pre-cleared. The
official codemods are therefore expected to produce **empty diffs** and are run
only as verification (§5, Phase 0).

Dependency audit: **all ~30 React-facing packages are compatible as-is.** Every
currently-resolved version's peer range admits React 19 (16 Radix packages:
`^16.8 || ^17.0 || ^18.0 || ^19.0`; @tanstack/react-query `^18 || ^19`;
@sentry/react `16.14–19.x`; @dnd-kit, wouter, react-day-picker: `>=16.8`;
lucide-react `^16.5.1 || ^17 || ^18 || ^19`; react-markdown `>=18`; recharts
`^16.8–^19`; @testing-library/react
`^18 || ^19`; @clerk/react — see §7 risk register). **Zero library bumps are
required.** Vitest/jsdom/user-event/jest-dom/Cypress have no React peers.

## 2. Version changes (the entire required dependency diff)

| Package | From | To |
| --- | --- | --- |
| `react` | `^18.3.1` | `^19.2.8` |
| `react-dom` | `^18.3.1` | `^19.2.8` |
| `@types/react` | `^18.3.29` | `^19.2.18` |
| `@types/react-dom` | `^18.3.7` | `^19.2.4` |

```bash
pnpm add react@^19.2.8 react-dom@^19.2.8
pnpm add -D @types/react@^19.2.18 @types/react-dom@^19.2.4
```

Notes:

- `react-dom@19.2.8` peer-requires `react@^19.2.8` — the pair must move in
  lockstep. `scheduler` converges on a single `0.27.0` (nothing else consumes it).
- `@types/react-dom@19.2.4` peer-requires `@types/react@^19.2.0` — consistent pair.
- The official guide suggests `--save-exact`; this repo's convention is caret
  ranges, which is safe here because CI and Railway install with
  `--frozen-lockfile` (no drift without an explicit `pnpm update`).
- **No `overrides` changes.** Neither the npm `overrides` block nor
  `pnpm.overrides` needs a new entry, so the keep-in-sync rule is not triggered.
  None of the 22 existing overrides' "Remove when" conditions are satisfied by
  this upgrade (the relevant parents — @clerk/react, eslint-plugin-react-hooks,
  vite — are not bumped).
- After install, verify single-copy resolution:
  `pnpm why @types/react` must show exactly one `@types/react@19.x` (every
  observed peer range admits it, so no duplicate 18/19 pair is expected), and
  the lockfile must resolve recharts' `react-is` peer to `19.2.8` (a stale
  `react-is@18` is the classic recharts-on-19 breakage).

## 3. Required code changes

### 3.1 Three `RefObject` annotations gain `| null` (type-level break)

Under `@types/react@19`, `useRef<HTMLInputElement>(null)` returns
`RefObject<HTMLInputElement | null>`, which no longer satisfies a bare
`RefObject<HTMLInputElement>` parameter (`current` became mutable and non-null):

- `client/src/hooks/useOnboarding.ts:30` — `fileInputRef: RefObject<HTMLInputElement>`
- `client/src/hooks/usePlanImport.ts:16` — `fileInputRef?: RefObject<HTMLInputElement>`
- `client/src/components/settings/coaching/CoachingMaterialList.tsx:12` — `fileInputRef: React.RefObject<HTMLInputElement>`

Fix: add `| null` inside the generic at each site. This is **also valid under
the current 18 types** (in 18, `RefObject<T>.current` is already `T | null`),
so these three edits can land ahead of the version bump (Phase 0). Failing
call sites otherwise: `client/src/hooks/useTimelineState.ts:44` and
`client/src/components/settings/CoachingSection.tsx:41`.

### 3.2 Sentry root error handlers (behavior-level break)

React 19 no longer re-throws render errors: uncaught errors go to
`window.reportError`, errors caught by an Error Boundary go to `console.error`
only. `client/src/main.tsx:44` calls `createRoot()` with no options, so
boundary-caught render errors would stop reaching Sentry as events. Wire the
root options:

```tsx
createRoot(document.getElementById("root")!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(/* unchanged */);
```

`Sentry.reactErrorHandler` exists since @sentry/react 8.6 (installed: 10.69.0)
and no-ops until `Sentry.init` runs, so the S11 deferred-consent init in
`setupErrorReporting()` is unaffected. `Sentry.ErrorBoundary` itself keeps
working (it captures via `componentDidCatch`).

### 3.3 Documentation updates (same PR)

- `README.md:20` — shields.io badge `React-18` → `React-19`
- `README.md:103` — "Framework: React 18, Vite 8, TypeScript 7"
- `README.md:150` — mermaid node "Vite + React 18"
- `docs/client.md:7` — "React 18 (via react-dom/client createRoot)" (also fix
  the stale "Vite 6" on line 8 while there — package.json has vite ^8)

## 4. Expected-clean but verified items

- **Typecheck surface**: `tsconfig.json` excludes only `**/*.test.ts`, so all
  122 `client/src/**/*.test.tsx` files are typechecked by plain `pnpm check` —
  the audit covered them (clean). `tsconfig.strict.json` covers `shared/**`
  only (no React surface). The 65 legacy test files excluded by
  `tsconfig.test.json` will silently accumulate type drift — pre-existing gap,
  not widened by this upgrade (the 66th exclusion, `client/src/main.tsx`, is
  still covered by the main config).
- **TS toolchain**: checks run on the native TS 7 binary (`typescript7` alias).
  `@types/react@19.2.18` declares a TS 5.6 minimum (DefinitelyTyped publishes
  it for TS 5.6–6.0); no floor conflict with TS 6.0.3 or 7.0.2. After the bump,
  diff `pnpm check` output once against `node_modules/typescript/bin/tsc`
  (TS 6.0.3, what the editor/typescript-eslint sees) to confirm error parity.
- **Deprecation-only type churn** (compiles fine on 19, cleanup in §6.1):
  52 × `React.ElementRef` (deprecated → `ComponentRef`) across 15 vendored
  `client/src/components/ui/` files; 15 × `MutableRefObject` (deprecated →
  `RefObject`) across 6 files.
- **Build config**: `vite.config.ts` needs no changes — `resolve.dedupe`
  already covers react/react-dom (line 108), the `vendor-react` chunk group
  regex is version-agnostic, no optimizeDeps/define entries, `react()` plugin
  option-free. `script/build.ts` and `script/bundle-check.ts` have no
  size budgets a React bump can trip; re-run `pnpm check:bundle` to confirm
  the two structural invariants (recharts off the eager path; no drizzle in
  client chunks).
- **eslint**: `eslint-plugin-react-hooks@7.1.1` is React-19-era (ships the
  compiler-powered rules); `eslint-plugin-react` is not installed; nothing
  version-pinned.

## 5. Phased execution

### Phase 0 — Prep (landable before any version change)

- Apply the three `| null` annotation fixes (§3.1) — valid under 18 types.
- Confirm a clean dev console on 18.3.1 (no deprecation warnings) on the main
  user flows.
- Run the official codemods as a verification pass; expect **empty diffs** and
  treat any non-empty output as a new finding to review:

```bash
npx codemod@latest react/19/migration-recipe   # target: client/src
npx types-react-codemod@latest preset-19 ./client/src
```

### Phase 1 — The upgrade PR (single revertible PR)

1. Bump the four packages (§2); `pnpm install`; commit `pnpm-lock.yaml`.
2. `pnpm why @types/react` → exactly one 19.x copy; lockfile resolves
   `react-is` → 19.2.8 (recharts peer).
3. Wire Sentry root options (§3.2).
4. Docs updates (§3.3).
5. Full local gate run (mirrors CI):

```bash
pnpm check && pnpm check:strict && pnpm check:test
pnpm lint && pnpm format:check
pnpm test
pnpm run build && pnpm check:bundle
```

6. One-time TS 7 vs TS 6 error-parity comparison (§4).

### Phase 2 — Verification

CI gates that must pass (all existing, none new): `build.yml` (eslint, check,
check:strict, check:test, OpenAPI drift), `test.yml` (`pnpm test:coverage` with
ratcheted thresholds 68/62/60/67), `cypress.yml` (build, check:bundle,
integration, drizzle push, smoke, 12 e2e specs), SonarCloud quality gate (runs
via SonarQube Cloud Automatic Analysis, not an Actions workflow),
dependency-review (moderate+), gitleaks/DevSkim/Bearer.

Manual smoke focus — the React 19 behavior changes that don't throw:

- **Route transitions** (Suspense sibling pre-warming: fallbacks commit sooner;
  7 `lazy()` routes behind 2 boundaries in `App.tsx`) — spinner behavior on
  navigation.
- **Back/forward navigation** (popstate transitions are now synchronous —
  wouter history flows).
- **Timeline**: scroll-to-today, drag-and-drop (dnd-kit), virtualized list
  (@tanstack/react-virtual), bulk actions.
- **Analytics charts** (recharts) and **MuscleHeatMapCard / NexusMark SVGs** —
  confirm SVG-scoped `<title>` elements still render inside the `<svg>` subtree
  (React 19 hoists HTML-scope metadata only).
- **Coach chat** (SSE streaming updates — batching changed to microtask
  scheduling), **workout logging forms**, **day-picker**, **file-upload flows**
  (the three refs from §3.1: onboarding CSV import, plan import, coaching
  materials).
- **PWA update path**: old service worker keeps serving the complete React 18
  precache until all tabs close (atomic precache — no mixed 18/19 chunks, just
  a delayed rollout; `registerType: "prompt"` with an empty `onNeedRefresh`).
  Accept the delay, or wire a refresh toast first (§6.3).

Test-flake triage priority (behavioral timing, not API breakage):

1. The 7 files combining fake timers with React rendering — start with
   `client/src/pages/__tests__/Timeline.surfaceSync.test.tsx` (`act(() =>
   vi.advanceTimersByTime(...))` patterns), then the debounce hook tests.
2. The 50 files with `waitFor` (229 occurrences) — react-query mutation flows
   asserting intermediate states are the likely flake class.
3. If coverage dips below the ratchet from changed execution paths, re-measure
   and re-ratchet per the `vitest.config.ts` comment convention (~1pt below
   measured), in the same PR, with the measurement noted.

Post-merge: watch Sentry for new render-error events (the §3.2 wiring makes
previously-swallowed boundary-caught errors visible — an *increase* in reported
errors may be improved visibility, not a regression; check the error, not just
the count).

### Phase 3 — Soak

- Run on production for at least one week before starting any §6 follow-up
  that changes render behavior (StrictMode, Compiler).
- Note: `useId` format changed (`:r:` → `_r_` in 19.2). No first-party test or
  CSS selector depends on the format (audited), but treat any e2e selector
  breakage as this first.

---

## 6. Post-upgrade follow-ups (separate PRs, each optional)

Ordered by value/effort; none block the upgrade.

1. **Deprecation renames** (~1h, mechanical): `React.ElementRef` →
   `React.ComponentRef` (52 sites, 15 ui files), `MutableRefObject` →
   `RefObject` (15 sites, 6 files — `workout-editor/*`, `useWorkoutVoiceForm`,
   `VoiceFieldButton`).
2. **Add `<StrictMode>`** at the root (2 lines): the app has never run under
   StrictMode; React 19's dev double-invoking (including ref callbacks on
   mount) will surface latent effect bugs. Land alone, soak in dev for a
   sprint.
3. **PWA refresh toast**: implement `onNeedRefresh` in `main.tsx:53` so users
   pick up new versions without closing all tabs. Generic hygiene the upgrade
   makes visible.
4. **React Compiler evaluation**: `babel-plugin-react-compiler@1.0.0` is
   stable; the client has ~234 manual memoization call sites (70 `useMemo`,
   154 `useCallback`, 10 `memo`) across 85 files the compiler could subsume.
   `eslint-plugin-react-hooks@7.1.1` already ships the compiler lint rules.
   Caveats: verify the babel hook path under rolldown-vite
   (`@vitejs/plugin-react` may need `@rolldown/plugin-babel`), and adding
   babel forfeits the plugin's Babel-free fast transform path — measure build
   time before/after. 1–2 days including render-behavior validation.
5. **New-API adoption menu** (incremental, per-feature):
   - `useActionState`/`useOptimistic` for the three `onSubmit` forms
     (`BarcodeScanner`, `MafTestForm`, `ChatInput`) where TanStack Query cache
     invalidation isn't the point; keep `useMutation` for cache-driven writes.
   - Document metadata hoisting: render `<title>` from route components and
     retire `useDocumentTitle` (hook at `client/src/hooks/useDocumentTitle.ts`).
   - `use()` + `useSuspenseQuery` for read paths behind existing Suspense
     boundaries.
   - `<Activity>` (19.2) for tab/route keep-alive (e.g. preserving Timeline
     scroll/filter state across navigation).
   - ref-as-prop for the two non-vendored `forwardRef` components
     (`CoachPanelChatArea`, `TimelineDateGroup`); leave the 19 vendored
     shadcn/ui files for a future shadcn re-vendor (upstream shadcn dropped
     `forwardRef` in its React 19 refactor).
   - `<Context>` as provider (drop `.Provider`) opportunistically when touching
     context files.

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| @clerk/react tilde-pins React minors (`^18.0.0 \|\| ~19.0.3 \|\| ~19.1.4 \|\| ~19.2.3 \|\| ~19.3.0-0`) — 19.2.8 satisfies `~19.2.3`, and `~19.3.0-0` pre-authorizes all of stable 19.3.x (semver prerelease-bound rules), but a future React **19.4.x** falls outside the range until Clerk ships a new one | Medium (future) | Install warnings / auth regressions | Lockfile is frozen in CI; when bumping past 19.3 later, check `npm view @clerk/react peerDependencies` first |
| Stale `react-is@18` resolution breaks recharts element detection | Low | Charts crash | §2 lockfile check; optionally add `react-is@^19.2.8` as an explicit dep |
| waitFor / fake-timer test flakes from batching+microtask scheduling changes | Medium | CI red, triage time | Priority list in Phase 2; fix tests (assert final states), don't pin timing |
| Coverage ratchet trips from changed execution paths | Low–Medium | `test.yml` red | Re-measure and re-ratchet per house convention |
| Suspense fallback ordering perceptibly different on route transitions | Low | UX polish | Phase 2 manual smoke; adjust boundaries only if observed |
| Synchronous popstate transitions change back/forward behavior via wouter | Low | Navigation jank | Phase 2 manual smoke of history flows |
| Boundary-caught errors invisible to Sentry post-upgrade (if §3.2 skipped) | Certain if skipped | Silent error loss | §3.2 is a required part of the upgrade PR |
| dependency-review action flags a transitive advisory introduced by the new lockfile | Low | PR blocked | Resolve via the existing overrides pattern (both blocks, documented, with "Remove when") |
| Dependabot opens its own React 19 major PRs racing this plan | Medium | Duplicate work | Close them in favor of the staged PR; no ignore rule needed after the upgrade lands |
| PWA delayed rollout leaves users on React 18 bundle for days | Certain (by design) | Delayed fix latency, no breakage | Atomic precache = no mixed versions; §6.3 refresh toast shortens the window |

## 8. Rollback (required)

**Trigger criteria**: crash-loop or novel render-error spike in Sentry not
attributable to the improved §3.2 visibility; e2e regressions in production
smoke; any CI gate that cannot be fixed forward same-day after merge.

**Action**: revert the single upgrade PR (`git revert` of the merge commit).
Everything — package.json, `pnpm-lock.yaml`, `main.tsx` root options, docs —
travels in that one commit. The Phase 0 annotation fixes are valid under both
majors and are **not** reverted.

**Mechanics that make this safe**:

- Client-only change: no database migrations, no server behavior, no API
  contract changes anywhere in the upgrade.
- The revert redeploys a React 18 bundle through the same PWA update mechanics
  (atomic precache swap; `cleanupOutdatedCaches` garbage-collects the 19
  precache). Users who never received 19 never notice.
- `main.tsx` root options and the `| null` annotations do not exist in the
  reverted tree / are 18-compatible respectively, so no manual follow-up edits
  are required.

**Post-rollback verification**: `pnpm run build && pnpm check:bundle` green,
smoke suite green, Cypress e2e green, Sentry event rate back to baseline within
one deploy cycle.

**Re-attempt criteria**: root-caused the trigger, added a regression test (or
an upstream fix shipped), and the §5 gates pass again.
