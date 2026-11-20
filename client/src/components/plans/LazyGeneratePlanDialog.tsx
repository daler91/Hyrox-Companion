import { type ComponentProps, Suspense, useState } from "react";

import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { lazyWithReload } from "@/lib/lazyWithReload";

// Perf: the Timeline page (the app's landing route) always mounts the
// "Generate AI plan" dialog closed, from both TimelineFilters and the welcome
// empty state. A static import put the dialog, its four steps and its form
// hook (~38 kB of source) in the Timeline route chunk, though most visits
// never open it. Lazy-loading it moves that code into its own chunk, fetched
// on first open. See the 2026-11-20 entry in .jules/bolt.md.
const GeneratePlanDialog = lazyWithReload(() =>
  import("@/components/plans/GeneratePlanDialog").then((dialogModule) => ({
    default: dialogModule.GeneratePlanDialog,
  })),
);

type GeneratePlanDialogProps = ComponentProps<typeof GeneratePlanDialog>;

/**
 * Mounts the dialog the first time `open` turns true and keeps it mounted
 * after that, so its close animation, form state and an in-flight generation
 * ("you can close this window; it keeps generating") behave as they did
 * before it was lazy. Until then it renders nothing and the chunk is not
 * requested.
 */
export function LazyGeneratePlanDialog(props: Readonly<GeneratePlanDialogProps>) {
  const [hasOpened, setHasOpened] = useState(props.open);
  // Set during render (React's "adjust state on prop change" pattern) so the
  // dialog mounts in the same commit that opens it, with no effect round-trip.
  if (props.open && !hasOpened) setHasOpened(true);
  if (!hasOpened) return null;

  return (
    <FeatureErrorBoundaryWrapper featureName="Generate plan">
      <Suspense fallback={null}>
        <GeneratePlanDialog {...props} />
      </Suspense>
    </FeatureErrorBoundaryWrapper>
  );
}
