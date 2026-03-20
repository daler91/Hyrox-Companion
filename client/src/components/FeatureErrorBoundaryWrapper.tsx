import * as Sentry from "@sentry/react";
import { ReactNode } from "react";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";

interface Props {
  readonly children: ReactNode;
  readonly featureName: string;
}

export function FeatureErrorBoundaryWrapper({ children, featureName }: Readonly<Props>) {
  return (
    <Sentry.ErrorBoundary fallback={(props) => <FeatureErrorBoundary {...props} featureName={featureName} />}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
