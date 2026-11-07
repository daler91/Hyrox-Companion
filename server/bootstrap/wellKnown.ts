import type { Express } from "express";

/**
 * Digital Asset Links for the Android app (`/.well-known/assetlinks.json`).
 *
 * Android verifies an app's `autoVerify` intent filter for https://fitai.coach
 * by fetching this file and checking that it names the app's package and the
 * SHA-256 fingerprint of a certificate the installed APK is signed with. Once
 * verified, fitai.coach links (reminder emails, the Strava return page) open
 * in the app instead of the browser.
 *
 * List both fingerprints from Play Console → App integrity: the app signing
 * key (what Play-installed builds carry) and the upload key (what locally
 * installed release builds carry).
 *
 * Mounted at app level, ahead of CORS, auth and the SPA fallback, because
 * express.static ignores dot-directories and the fallback would otherwise
 * answer with index.html. Unconfigured, the path is a plain 404, so an
 * environment without an app never claims one.
 */

export interface AndroidAppLinkConfig {
  packageName?: string;
  /** SHA-256 certificate fingerprints, `AA:BB:…` (32 colon-separated bytes). */
  sha256Fingerprints?: readonly string[];
}

/** Parses the comma-separated ANDROID_APP_CERT_SHA256 value into normalised fingerprints. */
export function parseCertFingerprints(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((fingerprint) => fingerprint.trim().toUpperCase())
    .filter(Boolean);
}

export function buildAssetLinks(config: AndroidAppLinkConfig): unknown[] | null {
  const fingerprints = config.sha256Fingerprints ?? [];
  if (!config.packageName || fingerprints.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: config.packageName,
        sha256_cert_fingerprints: [...fingerprints],
      },
    },
  ];
}

export function registerWellKnownRoutes(app: Express, config: AndroidAppLinkConfig): void {
  const assetLinks = buildAssetLinks(config);
  const body = assetLinks ? JSON.stringify(assetLinks) : null;

  app.get("/.well-known/assetlinks.json", (_req, res) => {
    if (!body) {
      res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
      return;
    }
    // An hour: long enough to spare the verifier, short enough that a
    // fingerprint added for a new signing key is picked up the same day.
    res.set("Cache-Control", "public, max-age=3600");
    res.type("application/json").send(body);
  });
}
