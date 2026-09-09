/**
 * Operator tool for the Strava webhook push subscription.
 *
 *   pnpm strava:webhook status     # what Strava holds for this API application
 *   pnpm strava:webhook register   # ensure a subscription for this deployment's APP_URL
 *   pnpm strava:webhook delete     # remove the current subscription, whatever it points at
 *
 * The server registers the subscription itself (30 s after boot, then
 * six-hourly); this exists for the cases it deliberately leaves alone — a
 * subscription that points at another deployment (staging, an old domain) —
 * and for checking what Strava holds without reading logs. Needs
 * STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET in .env; `register` also needs a
 * public https APP_URL and a running server at that URL, because Strava
 * validates the callback synchronously while creating the subscription.
 *
 * See docs/integrations.md#automatic-sync.
 */
import { env } from "../server/env";
import {
  deleteStravaWebhookSubscription,
  ensureStravaWebhookSubscription,
  getStravaWebhookCallbackUrl,
  getStravaWebhookVerifyToken,
  listStravaWebhookSubscriptions,
  resolveStravaWebhookConfig,
  type StravaWebhookConfig,
} from "../server/stravaWebhook";
import { sanitizeForLog } from "../server/utils/sanitize";

const USAGE = "Usage: pnpm strava:webhook <status|register|delete>";

/**
 * Everything printed here came back in a Strava response body, so each string
 * crosses the log-injection boundary (server/utils/sanitize.ts) on its way to
 * the terminal — the same rule the server's own log lines follow.
 */
function printable(value: string | number): string {
  return sanitizeForLog(String(value));
}

/**
 * `status` and `delete` only need the application credentials; the callback
 * URL and verify token are informational there and may be absent.
 */
function credentialsOnlyConfig(): StravaWebhookConfig | null {
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) return null;
  return {
    clientId: env.STRAVA_CLIENT_ID,
    clientSecret: env.STRAVA_CLIENT_SECRET,
    callbackUrl: getStravaWebhookCallbackUrl() ?? "",
    verifyToken: getStravaWebhookVerifyToken() ?? "",
  };
}

async function status(): Promise<number> {
  const config = credentialsOnlyConfig();
  if (!config) {
    console.error("STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set.");
    return 2;
  }
  const resolved = resolveStravaWebhookConfig();
  const subscriptions = await listStravaWebhookSubscriptions(config);
  // Operator output: callback URLs and Strava's subscription ids only; the
  // client secret never leaves `config`.
  // bearer:disable javascript_lang_logger_leak
  console.log(
    JSON.stringify(
      {
        callbackUrl: config.callbackUrl || null,
        registrationEnabled: resolved.ok,
        ...(resolved.ok ? {} : { registrationBlockedBy: resolved.reason }),
        subscriptions: subscriptions.map((s) => ({
          id: printable(s.id),
          callbackUrl: printable(s.callback_url),
          ours: s.callback_url === config.callbackUrl,
        })),
      },
      null,
      2,
    ),
  );
  return 0;
}

async function register(): Promise<number> {
  const result = await ensureStravaWebhookSubscription();
  // Operator output: status, subscription id and callback URL only.
  // bearer:disable javascript_lang_logger_leak
  console.log(
    JSON.stringify(
      {
        ...result,
        ...("subscriptionId" in result ? { subscriptionId: printable(result.subscriptionId) } : {}),
        ...("existingCallbackUrl" in result
          ? { existingCallbackUrl: printable(result.existingCallbackUrl) }
          : {}),
      },
      null,
      2,
    ),
  );
  return result.status === "active" || result.status === "created" ? 0 : 1;
}

async function remove(): Promise<number> {
  const config = credentialsOnlyConfig();
  if (!config) {
    console.error("STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set.");
    return 2;
  }
  const subscriptions = await listStravaWebhookSubscriptions(config);
  if (subscriptions.length === 0) {
    console.log("No Strava webhook subscription to delete.");
    return 0;
  }
  for (const subscription of subscriptions) {
    await deleteStravaWebhookSubscription(config, subscription.id);
    // Operator output: Strava's subscription id and its (public) callback URL.
    // bearer:disable javascript_lang_logger_leak
    console.log(
      `Deleted Strava webhook subscription ${printable(subscription.id)} (${printable(subscription.callback_url)}).`,
    );
  }
  console.log(
    "The server re-registers its own subscription within six hours (or on its next boot).",
  );
  return 0;
}

async function main(): Promise<number> {
  const command = process.argv[2];
  switch (command) {
    case "status":
      return status();
    case "register":
      return register();
    case "delete":
      return remove();
    default:
      console.error(USAGE);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // StravaWebhookApiError carries operation + status only, never the URL
    // (and so never the client secret in its query string).
    // bearer:disable javascript_lang_logger_leak
    console.error(sanitizeForLog(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  },
);
