// One module for the Nutrition page's starts-closed dialogs, so the lazy
// wrappers in `lazyDialogs.ts` share a single chunk (one request, not eight).
// Nothing on the page's eager path may import this file: see `lazyDialogs.ts`.
export { BarcodeScanner } from "./BarcodeScanner";
export { CustomFoodDialog } from "./CustomFoodDialog";
export { DescribeMealDialog } from "./DescribeMealDialog";
export { LogFoodDialog } from "./LogFoodDialog";
export { MealTargetDialog } from "./MealTargetDialog";
export { ParsedMealReviewSheet } from "./ParsedMealReviewSheet";
export { RecipeBuilderDialog } from "./RecipeBuilderDialog";
export { TargetsDialog } from "./TargetsDialog";
