import webpush from "web-push";

import { env } from "./env";
import { logger } from "./logger";
import { assertResolvedHostIsPublic } from "./ssrfGuard";
import { storage } from "./storage";

let initialized = false;

function ensureInitialized(): boolean {
  if (initialized) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_EMAIL) {
    return false;
  }
  webpush.setVapidDetails(`mailto:${env.VAPID_EMAIL}`, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  initialized = true;
  return true;
}

export function isPushEnabled(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_EMAIL);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Send a push notification to a single subscription.
 * Returns true if sent, false if the subscription is stale (410 Gone).
 */
async function sendToSubscription(
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<boolean> {
  if (!ensureInitialized()) return false;

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  try {
    // 🛡️ Sentinel: Re-validate DNS resolution at send-time to prevent SSRF via DNS rebinding
    await assertResolvedHostIsPublic(sub.endpoint);
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("resolves to a private/loopback address")) {
      // bearer:disable javascript_lang_logger_leak — sub.id is a uuid, no secrets
      logger.warn(
        { subId: sub.id },
        "[push] Push endpoint resolved to private IP (DNS rebinding). Removing subscription.",
      );
      await storage.push.removeById(sub.id);
      return false;
    }

    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 410 || statusCode === 404) {
      // Subscription expired/invalid — clean up
      logger.info({ subId: sub.id }, "[push] Removing stale subscription");
      await storage.push.removeById(sub.id);
      return false;
    }
    logger.error({ err, subId: sub.id }, "[push] Failed to send notification");
    return false;
  }
}

/**
 * Send a push notification to all subscriptions for a given user.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!isPushEnabled()) return 0;

  const subs = await storage.push.getSubscriptionsForUser(userId);
  if (subs.length === 0) return 0;

  const results = await Promise.allSettled(subs.map((sub) => sendToSubscription(sub, payload)));

  return results.filter((r) => r.status === "fulfilled" && r.value === true).length;
}
