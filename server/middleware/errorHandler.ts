import { captureException } from "@sentry/node";
import type { NextFunction, Request, Response } from "express";

import { type AppError, ErrorCode, shouldReportToSentry } from "../errors";

// A loose shape for errors that are not AppErrors, so the error handler can
// read the ad-hoc status/code properties third-party middleware attaches.
interface LegacyError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  details?: unknown;
  /** Set by http-errors on every error it builds; true on a 4xx meant for the client. */
  expose?: boolean;
}

interface ErrorReply {
  readonly status: number;
  readonly message: string;
  readonly code: string;
  readonly details?: unknown;
}

const INTERNAL_ERROR_MESSAGE = "Internal Server Error";
const UPSTREAM_ERROR_MESSAGE = "A service we depend on failed. Please try again.";

const INTERNAL_ERROR_REPLY: ErrorReply = {
  status: 500,
  message: INTERNAL_ERROR_MESSAGE,
  code: ErrorCode.INTERNAL_SERVER_ERROR,
};

const MALFORMED_URL_REPLY: ErrorReply = {
  status: 400,
  message: "Malformed URL",
  code: ErrorCode.BAD_REQUEST,
};

function isAppError(err: AppError | LegacyError): err is AppError {
  return err.name === "AppError" && "code" in err;
}

/** The HTTP status a non-AppError carries, under either property name. */
function carriedStatus(err: LegacyError): number | undefined {
  const status = err.status ?? err.statusCode;
  return typeof status === "number" ? status : undefined;
}

/**
 * body-parser (400 malformed JSON, 413 oversized body) and csrf-csrf (403
 * EBADCSRFTOKEN) build their errors with http-errors, which sets `expose` on
 * every error and makes it true on a 4xx whose message is meant for the
 * client. Those are this app's own HTTP layer refusing the request, so their
 * status and message stand; one of its own 5xx is an internal fault.
 */
function httpLayerReply(err: LegacyError, status: number): ErrorReply {
  if (!err.expose || status < 400 || status >= 500) return INTERNAL_ERROR_REPLY;
  return {
    status,
    message: err.message || "An error occurred",
    code: err.code ?? ErrorCode.BAD_REQUEST,
    details: err.details,
  };
}

function describeError(err: AppError | LegacyError): ErrorReply {
  if (isAppError(err)) {
    return {
      status: err.status,
      // 🛡️ Sentinel: Prevent leaking sensitive error details to the client
      message: err.status === 500 ? INTERNAL_ERROR_MESSAGE : err.message || "An error occurred",
      code: err.code,
      details: err.details,
    };
  }
  const status = carriedStatus(err);
  if (status === undefined) return INTERNAL_ERROR_REPLY;
  if (err.expose !== undefined) return httpLayerReply(err, status);
  // The router's own refusal of a bad percent-escape in a route param: a
  // URIError with status 400 and no `expose`, thrown at route match before
  // auth or any limiter. It is the client's malformed URL, not an upstream
  // failure, and must stay a 400 that never reaches Sentry. Its message
  // quotes the raw param, so send a fixed one instead.
  // C3 (CODEBASE_ANALYSIS_2026-10-03)
  if (err instanceof URIError && status >= 400 && status < 500) return MALFORMED_URL_REPLY;
  // Any other status belongs to someone else's API: a Gemini or provider
  // 400/429 thrown by a parser with no try/catch, a rotated key's 401/403, a
  // Strava 404. Passed on, the athlete got Google's raw error JSON, the client
  // read a provider 429 as the app's own rate limit, and a key problem looked
  // like the athlete's session had expired. Report it as the upstream failure
  // it is, with a message of our own, the way parseExercisesFromText already
  // wraps the same errors as a 502. C3 (CODEBASE_ANALYSIS_2026-10-03)
  return { status: 502, message: UPSTREAM_ERROR_MESSAGE, code: ErrorCode.EXTERNAL_API_ERROR };
}

/**
 * The global Express error handler: every thrown `AppError` and anything else
 * passed to `next(err)` (CSRF failures, body-parser rejections, provider
 * errors a handler did not catch) ends here as `{ error, code }`.
 */
export function globalErrorHandler(
  err: AppError | LegacyError,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const reply = describeError(err);

  // Only server faults and sustained rate-limiting are Sentry-worthy; see
  // shouldReportToSentry. Everything is still logged and still returned.
  if (shouldReportToSentry(reply.status)) captureException(err);

  // A response already under way (an SSE stream that failed mid-reply) can't
  // take a status or a JSON body; Express's default handler closes it.
  if (res.headersSent) {
    next(err);
    return;
  }

  // S3 — body-parser's default 413 message is just "request entity too large"
  // which gives the user no hint about the per-route limit (100kb default,
  // 2mb for coaching materials). Rewrite to something actionable.
  if (reply.status === 413) {
    res.status(413).json({
      error:
        "Request body too large for this endpoint — try a smaller payload or split the upload.",
      code: ErrorCode.PAYLOAD_TOO_LARGE,
    });
    return;
  }

  res.status(reply.status).json({
    error: reply.message,
    code: reply.code,
    ...(reply.status < 500 && reply.details ? { details: reply.details } : {}),
  });
}
