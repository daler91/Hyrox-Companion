import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface FeatureErrorBoundaryProps {
  readonly error: unknown;
  readonly resetError: () => void;
  readonly featureName?: string;
}

export function FeatureErrorBoundary({ error, resetError, featureName = "This section" }: Readonly<FeatureErrorBoundaryProps>) {
  const errorMessage = error instanceof Error ? error.toString() : String(error);

  return (
    <div
      className="w-full flex items-center justify-center p-4"
      data-testid={`feature-error-${featureName.toLowerCase().replaceAll(/\s/g, "-")}`}
    >
      <Card className="w-full max-w-md border-destructive/20">
        <CardContent className="pt-6 text-center flex flex-col items-center">
          <div className="h-11 w-11 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">
            {featureName} couldn&apos;t load
          </h2>
          <p className="text-sm text-muted-foreground mb-1">
            Your data is safe. The rest of the app is still available from the sidebar.
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Tap Try again to reload this section.
          </p>
          <Button onClick={resetError} variant="outline" size="sm" data-testid="button-feature-retry">
            <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
            Try again
          </Button>
          {process.env.NODE_ENV !== "production" && error !== undefined && error !== null && (
            <div className="mt-4 w-full text-left bg-muted p-3 rounded-md overflow-auto max-h-32">
              <p className="text-xs font-mono text-muted-foreground break-all">{errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
