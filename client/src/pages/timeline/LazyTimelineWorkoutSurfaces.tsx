import { type ComponentProps, Suspense } from "react";

import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { lazyWithReload } from "@/lib/lazyWithReload";

// Perf: the five workout sheets and seven dialogs in TimelineWorkoutSurfaces
// all start closed, but a static import put them and their editors (exercise
// table, structure editor, set editor) in the static graph of the Timeline
// route, the app's landing page. Lazy-loading them takes that code off the
// path to the first paint: the route's own static JS drops from 723.7 kB to
// 521.0 kB (222.7 kB to 166.1 kB gzip). See the 2026-11-17 entry in
// .jules/bolt.md.
const TimelineWorkoutSurfaces = lazyWithReload(() =>
  import("./TimelineWorkoutSurfaces").then((surfacesModule) => ({
    default: surfacesModule.TimelineWorkoutSurfaces,
  })),
);

/**
 * The Timeline's sheets and dialogs, fetched as soon as the Timeline has
 * rendered rather than on the first tap, so the chunk is normally in place
 * before the athlete opens a workout. Which surface is open is state the
 * Timeline owns, so a tap or a `?workout=` link that lands before the chunk
 * does is not lost: the surface shows once the chunk arrives.
 */
export function LazyTimelineWorkoutSurfaces(
  props: Readonly<ComponentProps<typeof TimelineWorkoutSurfaces>>,
) {
  return (
    <FeatureErrorBoundaryWrapper featureName="Workout details">
      <Suspense fallback={null}>
        <TimelineWorkoutSurfaces {...props} />
      </Suspense>
    </FeatureErrorBoundaryWrapper>
  );
}
