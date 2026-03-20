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

  return (
    <Sentry.ErrorBoundary fallback={fallback}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
