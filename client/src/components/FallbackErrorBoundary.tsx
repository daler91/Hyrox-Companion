import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface FallbackErrorBoundaryProps {
  readonly error: unknown;
  readonly resetError: () => void;
}

export function FallbackErrorBoundary({ error, resetError }: Readonly<FallbackErrorBoundaryProps>) {
  const errorMessage = error instanceof Error ? error.toString() : String(error);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center flex flex-col items-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Something went wrong</h1>
          <p className="text-sm text-muted-foreground mb-6">
            We apologize for the inconvenience. Please try refreshing the page or contact support if the problem persists.
          </p>
          <div className="flex gap-4">
            <Button onClick={resetError} variant="default">
              Try again
            </Button>
            <Button onClick={() => globalThis.window.location.reload()} variant="outline">
              Refresh Page
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
