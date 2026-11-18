import { type ComponentProps, Suspense, useState } from "react";

import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { lazyWithReload } from "@/lib/lazyWithReload";

// Perf: the Timeline (the landing page) mounts GeneratePlanDialog closed in
// both the filter bar and the welcome empty state, so a static import put the
// dialog, its four steps and its form hook (~42 kB source) in the Timeline
// route chunk for every visit, though few visits open it. Lazy-loading moves
// that code into its own chunk, fetched on first open. See the 2026-11-18
// entry in .jules/bolt.md. OnboardingWizard keeps the static import: it is a
// lazy chunk already.
const GeneratePlanDialog = lazyWithReload(() =>
  import("@/components/plans/GeneratePlanDialog").then((dialogModule) => ({
    default: dialogModule.GeneratePlanDialog,
  })),
);

type LazyGeneratePlanDialogProps = ComponentProps<typeof GeneratePlanDialog>;

/**
 * Mounts the dialog the first time `open` turns true and keeps it mounted
 * after that, so its close animation and step state work as they did before it
 * was lazy. Until then it renders nothing and the chunk is not requested.
 */
export function LazyGeneratePlanDialog(props: Readonly<LazyGeneratePlanDialogProps>) {
  const [hasOpened, setHasOpened] = useState(props.open);
  // Set during render (React's "adjust state on prop change" pattern) so the
  // dialog mounts in the same commit that opens it, with no effect round-trip.
  if (props.open && !hasOpened) setHasOpened(true);
  if (!hasOpened) return null;

  return (
    <FeatureErrorBoundaryWrapper featureName="Plan generator">
      <Suspense fallback={null}>
        <GeneratePlanDialog {...props} />
      </Suspense>
    </FeatureErrorBoundaryWrapper>
  );
}
