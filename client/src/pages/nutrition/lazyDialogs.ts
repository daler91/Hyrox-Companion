import { lazyWithReload } from "@/lib/lazyWithReload";

// Perf: the Nutrition page always mounts these eight dialogs and sheets
// closed. Static imports put them (~90 kB of source: the log-food form, the
// recipe builder, the barcode scanner, the target editors) in the route chunk,
// ahead of the first paint of the day's meals. Lazy-loading them takes that
// code off the route's static graph: the route's own static JS drops from
// 183.8 kB to 98.1 kB (62.2 kB to 35.5 kB gzip). See the 2026-11-27 entry in
// .jules/bolt.md.
//
// They are deferred, not gated: the page mounts them straight away, so the
// chunk is fetched as soon as the page has rendered and is normally in place
// before the first tap. Which dialog is open is state the page owns, so a tap
// that beats the chunk is not lost; the dialog shows once the chunk arrives.
// The import is memoised by the module loader, so all eight share one request.
const loadDialogs = () => import("./dialogs");

export const BarcodeScanner = lazyWithReload(() =>
  loadDialogs().then((m) => ({ default: m.BarcodeScanner })),
);
export const CustomFoodDialog = lazyWithReload(() =>
  loadDialogs().then((m) => ({ default: m.CustomFoodDialog })),
);
export const DescribeMealDialog = lazyWithReload(() =>
  loadDialogs().then((m) => ({ default: m.DescribeMealDialog })),
);
export const LogFoodDialog = lazyWithReload(() =>
  loadDialogs().then((m) => ({ default: m.LogFoodDialog })),
);
export const MealTargetDialog = lazyWithReload(() =>
  loadDialogs().then((m) => ({ default: m.MealTargetDialog })),
);
export const ParsedMealReviewSheet = lazyWithReload(() =>
  loadDialogs().then((m) => ({ default: m.ParsedMealReviewSheet })),
);
export const RecipeBuilderDialog = lazyWithReload(() =>
  loadDialogs().then((m) => ({ default: m.RecipeBuilderDialog })),
);
export const TargetsDialog = lazyWithReload(() =>
  loadDialogs().then((m) => ({ default: m.TargetsDialog })),
);
