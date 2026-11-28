import { type ComponentProps, type ReactNode, Suspense, useState } from "react";

import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { lazyWithReload } from "@/lib/lazyWithReload";

// Perf: the Nutrition page always mounts these four editors closed. They are
// opened rarely (setting targets, creating a custom food or recipe), but a
// static import put them and `macroTargetForm` (~40 kB of source) in the
// Nutrition route chunk on every visit. Lazy-loading them moves that code into
// chunks fetched on first open. The everyday flows (LogFoodDialog, barcode,
// describe/review meal) stay eager. See the 2026-11-28 entry in .jules/bolt.md.
const TargetsDialog = lazyWithReload(() =>
  import("./TargetsDialog").then((m) => ({ default: m.TargetsDialog })),
);
const MealTargetDialog = lazyWithReload(() =>
  import("./MealTargetDialog").then((m) => ({ default: m.MealTargetDialog })),
);
const RecipeBuilderDialog = lazyWithReload(() =>
  import("./RecipeBuilderDialog").then((m) => ({ default: m.RecipeBuilderDialog })),
);
const CustomFoodDialog = lazyWithReload(() =>
  import("./CustomFoodDialog").then((m) => ({ default: m.CustomFoodDialog })),
);

/**
 * Renders nothing (and requests no chunk) until `open` first turns true, then
 * stays mounted so the Radix close animation and in-dialog state behave as
 * they did when the dialog was eager.
 */
function OpenLatch({
  open,
  featureName,
  children,
}: Readonly<{ open: boolean; featureName: string; children: ReactNode }>) {
  const [hasOpened, setHasOpened] = useState(open);
  // Set during render so the dialog mounts in the same commit that opens it.
  if (open && !hasOpened) setHasOpened(true);
  if (!hasOpened) return null;
  return (
    <FeatureErrorBoundaryWrapper featureName={featureName}>
      <Suspense fallback={null}>{children}</Suspense>
    </FeatureErrorBoundaryWrapper>
  );
}

export function LazyTargetsDialog(props: Readonly<ComponentProps<typeof TargetsDialog>>) {
  return (
    <OpenLatch open={props.open} featureName="Nutrition targets">
      <TargetsDialog {...props} />
    </OpenLatch>
  );
}

export function LazyMealTargetDialog(props: Readonly<ComponentProps<typeof MealTargetDialog>>) {
  return (
    <OpenLatch open={props.state !== null} featureName="Meal target">
      <MealTargetDialog {...props} />
    </OpenLatch>
  );
}

export function LazyRecipeBuilderDialog(
  props: Readonly<ComponentProps<typeof RecipeBuilderDialog>>,
) {
  return (
    <OpenLatch open={props.open} featureName="Recipe builder">
      <RecipeBuilderDialog {...props} />
    </OpenLatch>
  );
}

export function LazyCustomFoodDialog(props: Readonly<ComponentProps<typeof CustomFoodDialog>>) {
  return (
    <OpenLatch open={props.state !== null} featureName="Custom food">
      <CustomFoodDialog {...props} />
    </OpenLatch>
  );
}
