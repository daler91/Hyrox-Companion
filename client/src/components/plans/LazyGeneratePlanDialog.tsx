import { type ComponentProps, Suspense, useState } from "react";

import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { lazyWithReload } from "@/lib/lazyWithReload";

// Perf: TimelineFilters and TimelineEmptyState always mount the plan-generation
// dialog with open={false}, so a static import put the dialog, its four steps,
// useGeneratePlanForm, usePlanGeneration and usePlanImport (~55 kB of source)
// in the Timeline route chunk, the app's landing page. Lazy-loading it moves
// that code into its own chunk, fetched the first time an athlete opens it.
const GeneratePlanDialog = lazyWithReload(() =>
  import("@/components/plans/GeneratePlanDialog").then((dialogModule) => ({
    default: dialogModule.GeneratePlanDialog,
  })),
);

type LazyGeneratePlanDialogProps = ComponentProps<typeof GeneratePlanDialog>;

/**
 * Mounts the dialog the first time `open` turns true and keeps it mounted after
 * that, so its close animation and form state behave as they did before it was
 * lazy. Until then it renders nothing and the chunk is not requested.
 */
export function LazyGeneratePlanDialog(props: Readonly<LazyGeneratePlanDialogProps>) {
  const [hasOpened, setHasOpened] = useState(props.open);
  // Set during render (React's "adjust state on prop change" pattern) so the
  // dialog mounts in the same commit that opens it, with no effect round-trip.
  if (props.open && !hasOpened) setHasOpened(true);
  if (!hasOpened) return null;

  return (
    <FeatureErrorBoundaryWrapper featureName="Plan generation">
      <Suspense fallback={null}>
        <GeneratePlanDialog {...props} />
      </Suspense>
    </FeatureErrorBoundaryWrapper>
  );
}
