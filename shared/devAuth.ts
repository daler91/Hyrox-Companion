/**
 * The header a web client running with auth bypassed (the dev preview, or
 * Cypress) sends on every API call to ask a dev server for the dev-user
 * fallback.
 *
 * A dev server without Clerk keys runs every request as the dev user anyway.
 * One WITH Clerk keys runs a request as the dev user only when it carries
 * this header, so a signed-out request from an ordinary browser tab gets the
 * same 401 it would in production instead of quietly working (tech debt #34).
 * Production refuses to boot with the bypass enabled, so the header does
 * nothing there.
 */
export const DEV_AUTH_BYPASS_HEADER = "x-dev-auth-bypass";
