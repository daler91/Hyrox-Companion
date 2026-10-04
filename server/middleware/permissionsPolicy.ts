import type { RequestHandler } from "express";

/**
 * The Permissions-Policy every response carries, the SPA document included.
 *
 * camera and microphone are allowed for the app's own origin only: the
 * nutrition barcode scanner opens the camera through getUserMedia, and voice
 * dictation opens the microphone. `camera=()` turned the camera off for the
 * top-level page, so Chromium (the only engine with BarcodeDetector) rejected
 * the scanner's getUserMedia without a prompt and the live scanner could not
 * work in production. C2 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const PERMISSIONS_POLICY = "camera=(self), microphone=(self), geolocation=()";

export const permissionsPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  next();
};
