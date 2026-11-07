1. **Optimize `client/src/hooks/usePlanProposal.ts`**:
   - In `undoneMessage`, replace the chained `.map().filter(Boolean)` with a single `for...of` loop to prevent intermediate array allocations.

2. **Optimize `client/src/components/coach/PlanProposalCard.tsx`**:
   - In `PlanProposalCard` component, replace the chained `.map().filter()` with a single `for...of` loop.

3. **Verify changes using `cat` or `read_file`**:
   - Verify the edits made to `client/src/hooks/usePlanProposal.ts`.
   - Verify the edits made to `client/src/components/coach/PlanProposalCard.tsx`.

4. **Verify tests and run lint**:
   - Run `pnpm test usePlanProposal PlanProposalCard`.
   - Run `NODE_OPTIONS="--max-old-space-size=4096" pnpm lint`.

5. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done**.

6. **Submit PR**:
   - PR Title: `⚡ Bolt: [performance improvement] Replace chained array methods with single loops`
   - Description should detail What, Why, Impact, and Measurement.
