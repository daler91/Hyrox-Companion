import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface FallbackErrorBoundaryProps {
  readonly error: unknown;
  readonly resetError: () => void;
}

export function FallbackErrorBoundary({ error, resetError }: Readonly<FallbackErrorBoundaryProps>) {
  const errorMessage = error instanceof Error ? error.toString() : String(error);

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center bg-background p-4"
      data-testid="error-boundary-fallback"
    >
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center flex flex-col items-center">
          <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Something unexpected happened</h1>
          <p className="text-sm text-muted-foreground mb-1">
            We hit a snag loading the app. Your training data is safe — nothing has been lost.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Try again below. If this keeps happening, a full refresh usually clears it up.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button onClick={resetError} variant="default" data-testid="button-retry">
              <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
              Try again
            </Button>
            <Button
              onClick={() => globalThis.window.location.reload()}
              variant="outline"
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              Refresh page
            </Button>
          </div>
          {process.env.NODE_ENV !== "production" && error !== undefined && error !== null && (
            <div className="mt-6 w-full text-left bg-muted p-4 rounded-md overflow-auto max-h-40">
              <p className="text-xs font-mono text-muted-foreground break-all">{errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
