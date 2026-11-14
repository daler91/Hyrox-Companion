import { type ComponentProps, Suspense, useState } from "react";

import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { lazyWithReload } from "@/lib/lazyWithReload";

// Perf: the onboarding wizard is shown once per account, but a static import
// put it, all of its steps, and react-day-picker (used only by ScheduleStep's
// calendar) in the Timeline route chunk, the app's landing page. Lazy-loading
// it moves that code into its own chunk, so returning users don't download or
// parse it. See the 2026-11-14 entry in .jules/bolt.md.
const OnboardingWizard = lazyWithReload(() =>
  import("@/components/OnboardingWizard").then((wizardModule) => ({
    default: wizardModule.OnboardingWizard,
  })),
);

type TimelineOnboardingWizardProps = ComponentProps<typeof OnboardingWizard>;

/**
 * Mounts the wizard the first time `open` turns true and keeps it mounted after
 * that, so its close animation and step state work as they did before it was
 * lazy. Until then it renders nothing and the chunk is not requested.
 */
export function TimelineOnboardingWizard({ open, onComplete }: Readonly<TimelineOnboardingWizardProps>) {
  const [hasOpened, setHasOpened] = useState(open);
  // Set during render (React's "adjust state on prop change" pattern) so the
  // wizard mounts in the same commit that opens it, with no effect round-trip.
  if (open && !hasOpened) setHasOpened(true);
  if (!hasOpened) return null;

  return (
    <FeatureErrorBoundaryWrapper featureName="Onboarding">
      <Suspense fallback={null}>
        <OnboardingWizard open={open} onComplete={onComplete} />
      </Suspense>
    </FeatureErrorBoundaryWrapper>
  );
}
