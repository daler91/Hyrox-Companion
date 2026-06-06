import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useHasBlockingModalLayer } from "@/components/ui/modal-layer";
import { recordServerConsent } from "@/lib/api/consent";
import { disableErrorReporting, enableErrorReporting } from "@/lib/errorReportingConsent";
import { hasAcknowledgedPrivacyNotice, onPrivacyConsentChange, recordPrivacyConsent } from "@/lib/privacyConsent";

/**
 * First-load notice listing the third-party services that process user data
 * (Sentry error tracking, browser push, optional AI/OAuth integrations). PII is
 * scrubbed from Sentry and health data never leaves the server, but disclosure
 * is still the right default.
 *
 * Notice acknowledgement and the Sentry/telemetry decision are now recorded
 * separately (W4): "Accept" keeps error reporting on, "Decline analytics" turns
 * it off, and both persist a localStorage gate plus a best-effort server-side
 * consent record for authenticated users (GDPR Art. 7 / CCPA).
 */
export function PrivacyConsentBanner() {
  const hasBlockingModalLayer = useHasBlockingModalLayer();
  // Lazy initializer reads localStorage once on mount rather than triggering
  // a cascading setState inside useEffect. hasAcknowledgedPrivacyNotice() guards
  // against missing window / denied storage.
  const [visible, setVisible] = useState<boolean>(() => !hasAcknowledgedPrivacyNotice());

  // Self-hide if consent is recorded AFTER mount (our own buttons, another tab,
  // or a Cypress command that seeds the key post-visit).
  useEffect(() => {
    const check = () => {
      if (hasAcknowledgedPrivacyNotice()) setVisible(false);
    };
    check();
    return onPrivacyConsentChange(check);
  }, []);

  if (!visible || hasBlockingModalLayer) return null;

  // Always record the notice acknowledgement; when the user made an explicit
  // telemetry choice (Accept/Decline), also apply + record the error-reporting
  // decision. The bare X dismisses the notice without implying telemetry consent.
  const acknowledge = (errorReportingDecision?: boolean) => {
    recordPrivacyConsent();
    void recordServerConsent("privacy_notice", true);
    if (errorReportingDecision !== undefined) {
      if (errorReportingDecision) {
        enableErrorReporting();
      } else {
        disableErrorReporting();
      }
      void recordServerConsent("error_reporting", errorReportingDecision);
    }
    setVisible(false);
  };

  return (
    <section
      aria-label="Privacy notice"
      className="fixed inset-x-0 bottom-0 z-[60] border-t bg-background/95 backdrop-blur-sm shadow-lg"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 p-4 text-sm md:flex-row md:items-center md:justify-between">
        <p className="text-muted-foreground">
          We use Sentry for error tracking (PII scrubbed), and you can opt into Strava, Garmin, and
          AI coaching, each off by default. Decline analytics below, or change it anytime in Settings.{" "}
          <Link to="/privacy" className="rounded underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Read our privacy policy
          </Link>
          .
        </p>
        <div className="flex items-center gap-2 self-end md:self-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={() => acknowledge(false)}
            data-testid="btn-consent-decline"
          >
            Decline analytics
          </Button>
          <Button size="sm" onClick={() => acknowledge(true)} data-testid="btn-consent-ack">
            Accept
          </Button>
          <button
            type="button"
            onClick={() => acknowledge()}
            aria-label="Dismiss privacy notice"
            className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
