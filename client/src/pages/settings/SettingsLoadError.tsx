import { Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/PageContainer";

/** Full-page fallback when the preferences query fails with nothing cached. */
export function SettingsLoadError({
  error,
  isFetching,
  onRetry,
}: Readonly<{ error: unknown; isFetching: boolean; onRetry: () => void }>) {
  const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";

  return (
    <PageContainer size="narrow">
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Couldn&apos;t load settings</CardTitle>
          <CardDescription>
            We couldn&apos;t load your preferences right now. Please try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Raw error text is dev-only — the CardDescription above carries the
              user-facing message. Surfacing `error.message` (e.g. "500: …") in
              production is confusing and can leak internals (matches
              FallbackErrorBoundary's NODE_ENV gate). */}
          {import.meta.env.DEV && <p className="text-sm text-muted-foreground">{errorMessage}</p>}
          <Button onClick={onRetry} disabled={isFetching} data-testid="button-retry-load-settings">
            {isFetching ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCw className="h-4 w-4 mr-2" aria-hidden="true" />
            )}
            {isFetching ? "Retrying…" : "Retry"}
          </Button>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
