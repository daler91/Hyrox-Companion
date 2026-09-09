import crypto from "node:crypto";

import type { Request, Response, Router } from "express";
import { z } from "zod";

import { DEFAULT_RATE_LIMIT_WINDOW_MS, EXTERNAL_API_TIMEOUT_MS, MS_PER_DAY } from "./constants";
import { env } from "./env";
import { logger, reqLogger } from "./logger";
import { asyncHandler, rateLimiter } from "./routeUtils";
import { enqueueStravaSync, isStravaAutoSyncEnabled } from "./services/stravaSyncQueue";
import { deleteRuntimeCache, getRuntimeCache, setRuntimeCache } from "./sharedRuntimeState";
import { checkSafeOutboundUrl } from "./ssrfGuard";
import { storage } from "./storage";

// =============================================================================
// Strava webhook push subscription — the near-real-time half of automatic sync
// =============================================================================
//
// Strava's Webhook Events API pushes one POST per activity create/update/
// delete (and per athlete deauthorization) to a callback URL registered on
// the Strava API application. One subscription per application; Strava
// validates the callback with a GET challenge when the subscription is
// created, then expects every event POST to be acknowledged with a 200 within
// two seconds (it retries anything else up to three times).
//
// Trust model. Event POSTs are neither signed nor authenticated, so nothing
// here believes the payload: an event only ever *enqueues an incremental sync
// for the athlete it names*, and that sync fetches from Strava with the
// athlete's own token, dedups against the DB and reconciles like any other
// sync (server/strava.ts). The worst a forged event can do is trigger one
// debounced sync for one connected athlete, bounded by the per-IP rate limit
// below. Athlete deauthorizations get the same treatment: the sync's own 401
// handling tombstones the connection, so we never flip a user to "reconnect
// needed" on an unsigned say-so.
//
// The polling fallback (server/services/stravaAutoSync.ts) covers deployments
// without a public https APP_URL and any event Strava drops.

export const STRAVA_WEBHOOK_PATH = "/api/v1/strava/webhook";
const STRAVA_PUSH_SUBSCRIPTIONS_URL = "https://www.strava.com/api/v3/push_subscriptions";

const LOG_CTX = "strava-webhook" as const;

// Shared (cross-replica) record of the verified subscription: which id
// Strava assigned us and the callback it points at. Refreshed by every
// ensure run (boot + six-hourly), so the TTL only matters once no replica has
// run ensure for a week.
const STRAVA_WEBHOOK_STATE_CACHE_KEY = "strava:webhook-subscription";
const STRAVA_WEBHOOK_STATE_TTL_MS = 7 * MS_PER_DAY;
// In-process memo of that record; /status and the event receiver read it
// far more often than it changes.
const STRAVA_WEBHOOK_STATE_MEMO_MS = 10 * 60 * 1000;

// Strava delivers every event for every athlete from a handful of IPs, so
// this is a flood guard for the unauthenticated receiver, not a per-athlete
// budget: 300 events a minute is far beyond what any real athlete base of
// this app produces.
const stravaWebhookLimiter = rateLimiter("stravaWebhook", 300, DEFAULT_RATE_LIMIT_WINDOW_MS);

export interface StravaWebhookConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  verifyToken: string;
}

export type StravaWebhookConfigResult =
  | { ok: true; config: StravaWebhookConfig }
  | {
      ok: false;
      reason:
        "auto_sync_disabled" | "webhooks_disabled" | "missing_credentials" | "app_url_not_public";
    };

/**
 * The token Strava echoes back when it validates the callback URL. Explicit
 * via STRAVA_WEBHOOK_VERIFY_TOKEN, else derived from the client secret so it
 * is stable across restarts and replicas without another secret to manage.
 * Knowing it buys nothing beyond answering Strava's own challenge.
 */
export function getStravaWebhookVerifyToken(): string | null {
  if (env.STRAVA_WEBHOOK_VERIFY_TOKEN) return env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!env.STRAVA_CLIENT_SECRET) return null;
  return crypto
    .createHmac("sha256", env.STRAVA_CLIENT_SECRET)
    .update("strava-webhook-verify-token")
    .digest("hex");
}

/**
 * `${APP_URL}/api/v1/strava/webhook`, but only when Strava could actually
 * reach it: https, and not a loopback or private host (the SSRF guard's own
 * test, reused). Local development and CI keep APP_URL on a loopback host,
 * and a subscription pointing there would fail Strava's validation anyway.
 */
export function getStravaWebhookCallbackUrl(): string | null {
  if (!env.APP_URL) return null;
  let base: URL;
  try {
    base = new URL(env.APP_URL);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" || !checkSafeOutboundUrl(env.APP_URL).ok) return null;
  return `${env.APP_URL.replace(/\/$/, "")}${STRAVA_WEBHOOK_PATH}`;
}

export function resolveStravaWebhookConfig(): StravaWebhookConfigResult {
  if (!isStravaAutoSyncEnabled()) return { ok: false, reason: "auto_sync_disabled" };
  if (env.STRAVA_WEBHOOKS_ENABLED === "false") return { ok: false, reason: "webhooks_disabled" };
  const verifyToken = getStravaWebhookVerifyToken();
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET || !verifyToken) {
    return { ok: false, reason: "missing_credentials" };
  }
  const callbackUrl = getStravaWebhookCallbackUrl();
  if (!callbackUrl) return { ok: false, reason: "app_url_not_public" };
  return {
    ok: true,
    config: {
      clientId: env.STRAVA_CLIENT_ID,
      clientSecret: env.STRAVA_CLIENT_SECRET,
      callbackUrl,
      verifyToken,
    },
  };
}

// -----------------------------------------------------------------------------
// Strava push_subscriptions API
// -----------------------------------------------------------------------------

export interface StravaPushSubscription {
  id: number;
  callback_url: string;
}

/**
 * Carries the operation and HTTP status only. The subscription endpoints
 * take the client secret as a query parameter, so upstream errors are never
 * rethrown with their URL attached.
 */
export class StravaWebhookApiError extends Error {
  constructor(
    readonly operation: "list" | "create" | "delete",
    readonly status: number,
  ) {
    super(`Strava push_subscriptions ${operation} failed with status ${status}`);
    this.name = "StravaWebhookApiError";
  }
}

function isPushSubscription(value: unknown): value is StravaPushSubscription {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; callback_url?: unknown };
  return typeof candidate.id === "number" && typeof candidate.callback_url === "string";
}

async function stravaSubscriptionsFetch(
  operation: StravaWebhookApiError["operation"],
  url: URL | string,
  init: RequestInit,
): Promise<globalThis.Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS) });
  } catch {
    // Network/timeout failure. Status 0 marks "no response"; the original
    // error is dropped on purpose so the URL (and its secret) cannot leak
    // through an error message.
    throw new StravaWebhookApiError(operation, 0);
  }
}

function withClientCredentials(url: string, config: StravaWebhookConfig): URL {
  const withCredentials = new URL(url);
  withCredentials.searchParams.set("client_id", config.clientId);
  withCredentials.searchParams.set("client_secret", config.clientSecret);
  return withCredentials;
}

export async function listStravaWebhookSubscriptions(
  config: StravaWebhookConfig,
): Promise<StravaPushSubscription[]> {
  const response = await stravaSubscriptionsFetch(
    "list",
    withClientCredentials(STRAVA_PUSH_SUBSCRIPTIONS_URL, config),
    {},
  );
  if (!response.ok) throw new StravaWebhookApiError("list", response.status);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? body.filter(isPushSubscription) : [];
}

/**
 * Strava validates the callback synchronously inside this request (a GET
 * with hub.challenge to `config.callbackUrl`), so the server must already be
 * listening and serving handleStravaWebhookValidation. Returns the new
 * subscription id.
 */
export async function createStravaWebhookSubscription(
  config: StravaWebhookConfig,
): Promise<number> {
  const response = await stravaSubscriptionsFetch("create", STRAVA_PUSH_SUBSCRIPTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      callback_url: config.callbackUrl,
      verify_token: config.verifyToken,
    }).toString(),
  });
  if (!response.ok) throw new StravaWebhookApiError("create", response.status);
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "number") {
    throw new StravaWebhookApiError("create", response.status);
  }
  return body.id;
}

export async function deleteStravaWebhookSubscription(
  config: StravaWebhookConfig,
  subscriptionId: number,
): Promise<void> {
  const response = await stravaSubscriptionsFetch(
    "delete",
    withClientCredentials(`${STRAVA_PUSH_SUBSCRIPTIONS_URL}/${subscriptionId}`, config),
    { method: "DELETE" },
  );
  // 404: already gone, which is the state we wanted.
  if (!response.ok && response.status !== 404) {
    throw new StravaWebhookApiError("delete", response.status);
  }
}

// -----------------------------------------------------------------------------
// Verified-subscription state
// -----------------------------------------------------------------------------

export interface StravaWebhookState {
  subscriptionId: number;
  callbackUrl: string;
  /** Epoch ms of the ensure run that last saw the subscription on Strava's side. */
  verifiedAt: number;
}

let stateMemo: { state: StravaWebhookState | null; at: number } | null = null;

/**
 * The subscription this deployment verified with Strava, or null when there
 * is none (or webhooks are switched off). Read by /status for the Settings
 * copy and by the event receiver to drop events for someone else's
 * subscription.
 */
export async function getStravaWebhookState(): Promise<StravaWebhookState | null> {
  if (!resolveStravaWebhookConfig().ok) return null;
  if (stateMemo && Date.now() - stateMemo.at < STRAVA_WEBHOOK_STATE_MEMO_MS) return stateMemo.state;
  try {
    const shared =
      (await getRuntimeCache<StravaWebhookState>(STRAVA_WEBHOOK_STATE_CACHE_KEY)) ?? null;
    stateMemo = { state: shared, at: Date.now() };
    return shared;
  } catch (err) {
    // A shared-cache blip must not make the receiver reject events or the
    // status flip-flop: fall back to whatever this process last knew.
    logger.debug({ context: LOG_CTX, err }, "Failed to read shared Strava webhook state");
    return stateMemo?.state ?? null;
  }
}

async function rememberStravaWebhookState(state: StravaWebhookState | null): Promise<void> {
  stateMemo = { state, at: Date.now() };
  try {
    if (state) {
      await setRuntimeCache(STRAVA_WEBHOOK_STATE_CACHE_KEY, state, STRAVA_WEBHOOK_STATE_TTL_MS);
    } else {
      await deleteRuntimeCache(STRAVA_WEBHOOK_STATE_CACHE_KEY);
    }
  } catch (err) {
    logger.warn({ context: LOG_CTX, err }, "Failed to persist shared Strava webhook state");
  }
}

/** Exposed only for tests; never call from request handlers. */
export function __resetStravaWebhookStateForTests(): void {
  stateMemo = null;
}

// -----------------------------------------------------------------------------
// Ensure
// -----------------------------------------------------------------------------

export type StravaWebhookEnsureResult =
  | { status: "active" | "created"; subscriptionId: number }
  | { status: "disabled"; reason: Extract<StravaWebhookConfigResult, { ok: false }>["reason"] }
  | { status: "mismatch"; subscriptionId: number; existingCallbackUrl: string }
  | { status: "failed" };

type EnsureLogger = Pick<typeof logger, "info" | "warn" | "error">;

/**
 * Idempotent: verify that Strava holds a subscription for this deployment's
 * callback URL, creating one when there is none. Runs shortly after boot and
 * six-hourly (server/cron.ts), so a subscription an operator deleted, or a
 * boot that happened while Strava was down, heals on its own.
 *
 * Strava allows exactly one subscription per API application. When the
 * existing one points somewhere else — a staging deployment sharing the
 * client id, an old domain — it is left alone and reported as a mismatch,
 * because replacing it would silently cut that other deployment off. The
 * operator resolves it with `pnpm strava:webhook delete` on the deployment
 * that should give it up.
 *
 * Never throws; every failure is logged and returned.
 */
export async function ensureStravaWebhookSubscription(
  log: EnsureLogger = logger,
): Promise<StravaWebhookEnsureResult> {
  const resolved = resolveStravaWebhookConfig();
  if (!resolved.ok) {
    stateMemo = null;
    return { status: "disabled", reason: resolved.reason };
  }
  const { config } = resolved;

  try {
    const subscriptions = await listStravaWebhookSubscriptions(config);
    const ours = subscriptions.find((s) => s.callback_url === config.callbackUrl);
    if (ours) {
      await rememberStravaWebhookState({
        subscriptionId: ours.id,
        callbackUrl: ours.callback_url,
        verifiedAt: Date.now(),
      });
      return { status: "active", subscriptionId: ours.id };
    }

    const other = subscriptions[0];
    if (other) {
      // Only the callback URL (a public address) and Strava's id are logged.
      // bearer:disable javascript_lang_logger_leak
      log.error(
        { context: LOG_CTX, subscriptionId: other.id, existingCallbackUrl: other.callback_url },
        "Strava webhook subscription belongs to another callback URL — automatic sync falls back to polling until it is removed (pnpm strava:webhook delete)",
      );
      await rememberStravaWebhookState(null);
      return {
        status: "mismatch",
        subscriptionId: other.id,
        existingCallbackUrl: other.callback_url,
      };
    }

    const subscriptionId = await createStravaWebhookSubscription(config);
    await rememberStravaWebhookState({
      subscriptionId,
      callbackUrl: config.callbackUrl,
      verifiedAt: Date.now(),
    });
    // Static message plus Strava's subscription id; no PII or secrets.
    // bearer:disable javascript_lang_logger_leak
    log.info({ context: LOG_CTX, subscriptionId }, "Strava webhook subscription created");
    return { status: "created", subscriptionId };
  } catch (err) {
    // err is a StravaWebhookApiError (operation + status, never the URL).
    // bearer:disable javascript_lang_logger_leak
    log.error(
      { context: LOG_CTX, err },
      "Strava webhook subscription check failed (non-fatal; polling fallback still runs)",
    );
    return { status: "failed" };
  }
}

// -----------------------------------------------------------------------------
// Event receipt
// -----------------------------------------------------------------------------

export const stravaWebhookEventSchema = z.object({
  object_type: z.enum(["activity", "athlete"]),
  object_id: z.number().int(),
  aspect_type: z.enum(["create", "update", "delete"]),
  owner_id: z.number().int(),
  subscription_id: z.number().int(),
  event_time: z.number().int().optional(),
  updates: z.record(z.string(), z.unknown()).optional(),
});

export type StravaWebhookEvent = z.infer<typeof stravaWebhookEventSchema>;

export type StravaWebhookEventDisposition =
  "enqueued" | "disabled" | "ignored_subscription" | "ignored_delete" | "unknown_owner";

type EventLogger = Pick<typeof logger, "info" | "warn">;

/**
 * Turn one event into (at most) one debounced sync per connected account the
 * athlete maps to. Deletions are left alone: the athlete may have enriched
 * their own log with that recording, and the timeline's unlink control is
 * the place to undo an import deliberately.
 */
export async function processStravaWebhookEvent(
  event: StravaWebhookEvent,
  log: EventLogger,
): Promise<StravaWebhookEventDisposition> {
  if (!resolveStravaWebhookConfig().ok) return "disabled";

  const state = await getStravaWebhookState();
  if (state && state.subscriptionId !== event.subscription_id) {
    // Static context plus Strava-assigned ids; no PII.
    // bearer:disable javascript_lang_logger_leak
    log.warn(
      { context: LOG_CTX, subscriptionId: event.subscription_id },
      "Ignoring Strava webhook event for an unknown subscription",
    );
    return "ignored_subscription";
  }
  if (event.object_type === "activity" && event.aspect_type === "delete") return "ignored_delete";

  const owners = await storage.users.listStravaConnectionUsersByAthleteId(String(event.owner_id));
  // A tombstoned connection cannot sync until the athlete reconnects, and
  // reconnecting enqueues its own first sync.
  const targets = owners.filter((owner) => !owner.requiresReauth);
  if (targets.length === 0) return "unknown_owner";

  for (const target of targets) {
    await enqueueStravaSync(target.userId, "webhook");
  }
  // Event kind and a count only; no athlete or activity identifiers.
  // bearer:disable javascript_lang_logger_leak
  log.info(
    {
      context: LOG_CTX,
      objectType: event.object_type,
      aspectType: event.aspect_type,
      users: targets.length,
    },
    "strava.webhook.enqueued",
  );
  return "enqueued";
}

function safeEqual(a: string, b: string): boolean {
  // Hash both sides so timingSafeEqual sees equal lengths whatever the input.
  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

/** Strava's subscription challenge: echo hub.challenge when hub.verify_token is ours. */
function handleStravaWebhookValidation(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const expected = getStravaWebhookVerifyToken();
  if (
    mode !== "subscribe" ||
    typeof token !== "string" ||
    typeof challenge !== "string" ||
    !expected ||
    !safeEqual(token, expected)
  ) {
    reqLogger(req).warn({ context: LOG_CTX }, "Rejected Strava webhook validation request");
    return res.status(403).json({ error: "Invalid verify token", code: "FORBIDDEN" });
  }
  res.json({ "hub.challenge": challenge });
}

async function handleStravaWebhookEvent(req: Request, res: Response) {
  const parsed = stravaWebhookEventSchema.safeParse(req.body);
  // Strava wants its 200 within two seconds and retries anything else up to
  // three times, so acknowledge first and do the work after. A malformed
  // body is acknowledged too: re-delivering it three more times helps no one.
  res.status(200).json({ received: true });

  const log = reqLogger(req);
  if (!parsed.success) {
    log.warn({ context: LOG_CTX }, "Ignoring malformed Strava webhook event");
    return;
  }
  try {
    const disposition = await processStravaWebhookEvent(parsed.data, log);
    if (disposition !== "enqueued") {
      // Disposition is one of a fixed set of strings; no PII.
      // bearer:disable javascript_lang_logger_leak
      log.info({ context: LOG_CTX, disposition }, "strava.webhook.skipped");
    }
  } catch (err) {
    // Already acknowledged to Strava; the polling fallback covers this athlete.
    // bearer:disable javascript_lang_logger_leak
    log.error({ context: LOG_CTX, err }, "Strava webhook event processing failed");
  }
}

/**
 * Mounted BEFORE the /api/v1 CSRF guard (server/routes.ts): Strava's POSTs
 * carry neither cookie nor token. Unauthenticated by design; see the trust
 * model at the top of this module.
 */
export function registerStravaWebhookRoutes(router: Router): void {
  router.get(STRAVA_WEBHOOK_PATH, stravaWebhookLimiter, handleStravaWebhookValidation);
  router.post(STRAVA_WEBHOOK_PATH, stravaWebhookLimiter, asyncHandler(handleStravaWebhookEvent));
}
