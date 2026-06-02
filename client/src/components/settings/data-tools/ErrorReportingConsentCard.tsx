import { ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyErrorReportingPreference } from "@/lib/errorReporting";
import {
  disableErrorReporting,
  enableErrorReporting,
  isErrorReportingEnabled,
} from "@/lib/errorReportingConsent";

// S11 — per-processor consent toggle for error reporting (Sentry). Stored
// browser-local; the change is applied immediately (Sentry is started/closed in
// place) rather than waiting for a reload.
export function ErrorReportingConsentCard() {
  const [enabled, setEnabled] = useState<boolean>(() => isErrorReportingEnabled());

  const handleChange = (next: boolean) => {
    if (next) {
      enableErrorReporting();
    } else {
      disableErrorReporting();
    }
    // Persisted above; apply to the live Sentry client now so the toggle takes
    // effect without a reload.
    applyErrorReportingPreference(next);
    setEnabled(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          Error Reporting
        </CardTitle>
        <CardDescription>
          Control whether anonymized crash and error diagnostics are sent to our error-monitoring
          processor (Sentry) to help us fix bugs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="error-reporting-consent" className="cursor-pointer">
              Send error diagnostics
            </Label>
            <p className="text-sm text-muted-foreground">
              No personal data or request bodies are included. Changes take effect immediately.
            </p>
          </div>
          <Switch
            id="error-reporting-consent"
            checked={enabled}
            onCheckedChange={handleChange}
            data-testid="switch-error-reporting-consent"
            aria-label="Send anonymized error diagnostics to the error-monitoring processor"
          />
        </div>
      </CardContent>
    </Card>
  );
}
