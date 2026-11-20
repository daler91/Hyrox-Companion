import * as Sentry from "@sentry/react";
import { ReactNode, useCallback } from "react";

import { FeatureErrorBoundary } from "./FeatureErrorBoundary";

interface Props {
  readonly children: ReactNode;
  readonly featureName: string;
}

export function FeatureErrorBoundaryWrapper({ children, featureName }: Readonly<Props>) {
  const fallback = useCallback(
    (errorData: { error: unknown; resetError: () => void }) => (
      <FeatureErrorBoundary error={errorData.error} resetError={errorData.resetError} featureName={featureName} />
    ),
    [featureName]
  );

  // Tags the report with the feature so Sentry can group and filter by it
  // (tech debt #56). The root onCaughtError skips errors a Sentry boundary
  // reports itself, so this tagged copy is the one that is sent.
  const beforeCapture = useCallback(
    (scope: Sentry.Scope) => {
      scope.setTag("feature", featureName);
    },
    [featureName]
  );

  return (
    <Sentry.ErrorBoundary fallback={fallback} beforeCapture={beforeCapture}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
