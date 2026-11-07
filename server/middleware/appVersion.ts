import type { Request, RequestHandler } from "express";

import { env } from "../env";
import { ErrorCode } from "../errors";

/**
 * Native app version gate.
 *
 * The web app is redeployed with the server, so it is always current. A
 * native app is not: an installed build keeps calling the API for months, and
 * a server change can only stay compatible with so many of them. The app
 * sends `X-App-Platform` and `X-App-Version` on every request; when the
 * operator sets a minimum for that platform (MIN_APP_VERSION_ANDROID /
 * MIN_APP_VERSION_IOS), anything older is answered 426 with code
 * APP_UPDATE_REQUIRED, which the app turns into an update prompt.
 *
 * Requests without a recognised platform header (the web app, Strava's
 * webhook, curl) pass untouched. A recognised platform with a missing or
 * malformed version is refused once a minimum is set: every build of the app
 * sends one, so a request that doesn't cannot be shown to be new enough.
 */

export const APP_PLATFORMS = ["android", "ios"] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

/** MAJOR.MINOR.PATCH, digits only. The same shape env.ts accepts for the minimums. */
const APP_VERSION = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;

export interface AppClient {
  platform: AppPlatform;
  /** The version as sent, when it is well formed; otherwise null. */
  version: string | null;
}

export function parseAppVersion(value: string): [number, number, number] | null {
  const match = APP_VERSION.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareAppVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function isAppPlatform(value: string): value is AppPlatform {
  return (APP_PLATFORMS as readonly string[]).includes(value);
}

/**
 * The native client a request comes from, or null when it carries no
 * recognised `X-App-Platform`. Only well-formed values are returned, so the
 * result is safe to put in a log line.
 */
export function readAppClient(req: Pick<Request, "headers">): AppClient | null {
  const platform = req.headers["x-app-platform"];
  if (typeof platform !== "string") return null;
  const normalized = platform.trim().toLowerCase();
  if (!isAppPlatform(normalized)) return null;
  const version = req.headers["x-app-version"];
  const trimmed = typeof version === "string" ? version.trim() : "";
  return { platform: normalized, version: parseAppVersion(trimmed) ? trimmed : null };
}

function minimumVersionFor(platform: AppPlatform): string | undefined {
  return platform === "android" ? env.MIN_APP_VERSION_ANDROID : env.MIN_APP_VERSION_IOS;
}

export const appVersionGate: RequestHandler = (req, res, next) => {
  const client = readAppClient(req);
  if (!client) {
    next();
    return;
  }
  const minimum = minimumVersionFor(client.platform);
  const minimumParts = minimum ? parseAppVersion(minimum) : null;
  if (!minimum || !minimumParts) {
    next();
    return;
  }
  const versionParts = client.version ? parseAppVersion(client.version) : null;
  if (versionParts && compareAppVersions(versionParts, minimumParts) >= 0) {
    next();
    return;
  }
  res.status(426).json({
    error: "This version of the app is no longer supported. Update it to keep going.",
    code: ErrorCode.APP_UPDATE_REQUIRED,
    minimumVersion: minimum,
  });
};
