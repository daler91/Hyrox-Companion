import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export interface FallbackErrorBoundaryProps {
  readonly error: unknown;
  readonly resetError: () => void;
}

export function FallbackErrorBoundary({ error, resetError }: FallbackErrorBoundaryProps) {
  const errorMessage = error instanceof Error ? error.toString() : String(error);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center flex flex-col items-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-sm text-gray-600 mb-6">
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
            <div className="mt-6 w-full text-left bg-gray-100 p-4 rounded-md overflow-auto max-h-40">
              <p className="text-xs font-mono text-gray-800 break-all">{errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
