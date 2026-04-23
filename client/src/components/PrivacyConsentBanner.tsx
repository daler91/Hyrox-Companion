import { X } from "lucide-react";
import { useEffect,useState } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";

const CONSENT_STORAGE_KEY = "fitai-privacy-consent-v1";
const CONSENT_CHANGED_EVENT = "fitai:privacy-consent-changed";

function hasStoredConsent(): boolean {
  if (globalThis.window === undefined) return true;
  try {
    return globalThis.localStorage.getItem(CONSENT_STORAGE_KEY) !== null;
  } catch {
    // Private-mode Safari / denied storage — treat as acknowledged so the
    // banner doesn't loop forever for users who can't persist the dismissal.
    return true;
  }
}

function recordConsent(): void {
  try {
    globalThis.localStorage.setItem(CONSENT_STORAGE_KEY, String(Date.now()));
    // Notify same-tab listeners — the native `storage` event only fires
    // across tabs, so we need a custom channel for our own listener below
    // (and for tests that set the key imperatively after mount).
    globalThis.window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
  } catch {
    // Storage unavailable; nothing to do — user will see the banner again
    // next session but that's acceptable.
  }
}

/**
 * Minimal first-load notice listing the third-party services that process
 * user data (Sentry error tracking, browser push, optional AI/OAuth
 * integrations). PII is scrubbed from Sentry and health data never leaves
 * the server, but disclosure is still the right default (W12). Dismissal
 * is persisted in localStorage.
 */
export function PrivacyConsentBanner() {
  // Lazy initializer reads localStorage once on mount rather than triggering
  // a cascading setState inside useEffect. hasStoredConsent() already guards
  // against missing window / denied storage.
  const [visible, setVisible] = useState<boolean>(() => !hasStoredConsent());

  // Self-hide if consent is recorded AFTER mount (our own dismiss button,
  // another tab, or a Cypress command that seeds the key post-visit). The
  // lazy initializer snapshots localStorage once, so without this listener
  // the banner sticks around and can overlay fixed-bottom interactive UI.
  useEffect(() => {
    if (globalThis.window === undefined) return;
    const check = () => {
      if (hasStoredConsent()) setVisible(false);
    };
    // Re-check on mount in case the key was set between render-time snapshot
    // and effect commit (covers the Cypress `window:before:load` race).
    check();
    globalThis.window.addEventListener(CONSENT_CHANGED_EVENT, check);
    globalThis.window.addEventListener("storage", check);
    return () => {
      globalThis.window.removeEventListener(CONSENT_CHANGED_EVENT, check);
      globalThis.window.removeEventListener("storage", check);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    recordConsent();
    setVisible(false);
  };

  return (
    <section
      aria-label="Privacy notice"
      className="fixed inset-x-0 bottom-0 z-[60] border-t bg-background/95 backdrop-blur-sm shadow-lg"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 p-4 text-sm md:flex-row md:items-center md:justify-between">
        <p className="text-muted-foreground">
          We use Sentry for error tracking (PII scrubbed), and you can opt into
          Strava, Garmin, and Google Gemini coaching — each is off by default.{" "}
          <Link to="/privacy" className="underline hover:text-foreground">
            Read our privacy policy
          </Link>
          .
        </p>
        <div className="flex items-center gap-2 self-end md:self-auto">
          <Button size="sm" onClick={dismiss} data-testid="btn-consent-ack">
            Got it
          </Button>
          <button
            type="button"
            onClick={dismiss}
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
