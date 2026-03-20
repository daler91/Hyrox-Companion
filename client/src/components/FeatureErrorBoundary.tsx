import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export interface FeatureErrorBoundaryProps {
  readonly error: unknown;
  readonly resetError: () => void;
  readonly featureName?: string;
}

export function FeatureErrorBoundary({ error, resetError, featureName = "This feature" }: Readonly<FeatureErrorBoundaryProps>) {
  const errorMessage = error instanceof Error ? error.toString() : String(error);

  return (
    <div className="w-full flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-red-100">
        <CardContent className="pt-6 text-center flex flex-col items-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">{featureName} is currently unavailable</h2>
          <p className="text-sm text-gray-600 mb-4">
            We encountered an error loading this section. The rest of the app should still work normally.
          </p>
          <Button onClick={resetError} variant="outline" size="sm">
            Try again
          </Button>
          {process.env.NODE_ENV !== "production" && error !== undefined && error !== null && (
            <div className="mt-4 w-full text-left bg-gray-50 p-3 rounded-md overflow-auto max-h-32">
              <p className="text-xs font-mono text-gray-800 break-all">{errorMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
