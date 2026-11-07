import {
  type RegisterDeviceTokenInput,
  registerDeviceTokenSchema,
  type UnregisterDeviceTokenInput,
  unregisterDeviceTokenSchema,
} from "@shared/schema";
import { type Request as ExpressRequest, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { env } from "../env";
import { readAppClient } from "../middleware/appVersion";
import {
  isAllowedPushEndpoint,
  isNativePushEnabled,
  isWebPushEnabled,
  sendPushToUser,
} from "../pushNotifications";
import { rateLimiter, validateBody } from "../routeUtils";
import { checkSafeOutboundUrl } from "../ssrfGuard";
import { storage } from "../storage";
import { getUserId } from "../types";
import { protectedDelete, protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

const subscribeSchema = z.object({
  // 🛡️ Sentinel: Enforce HTTPS to prevent SSRF against internal/local services
  endpoint: z
    .string()
    // 🛡️ Sentinel: bound attacker-controlled strings that are persisted (DoS / DB bloat)
    .max(2048)
    .url()
    .refine((url) => url.startsWith("https://") && checkSafeOutboundUrl(url).ok, {
      message: "Push endpoint must be an HTTPS URL and must not point to a local/private address",
    })
    // Only browser push services: any other host is a server the user picked,
    // which web-push would wait on and buffer without limit.
    // S2 (CODEBASE_ANALYSIS_2026-10-03)
    .refine(isAllowedPushEndpoint, { message: "Push endpoint must belong to a known browser push service" }),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

// 🛡️ Sentinel: Added rate limit to GET /api/v1/push/vapid-key to prevent enumeration/abuse
router.get("/api/v1/push/vapid-key", isAuthenticated, rateLimiter("push", 60), (_req: ExpressRequest, res: Response) => {
  if (!isWebPushEnabled()) {
    res.status(404).json({ error: "Push notifications not configured", code: "PUSH_NOT_CONFIGURED" });
    return;
  }
  res.json({ publicKey: env.VAPID_PUBLIC_KEY });
});

protectedPost(router, "/api/v1/push/subscribe", { limiter: rateLimiter("push", 10), middleware: [validateBody(subscribeSchema)] }, async (req: ExpressRequest, res: Response) => {
  const userId = getUserId(req);
  const { endpoint, keys } = req.body as z.infer<typeof subscribeSchema>;
  await storage.push.saveSubscription(userId, {
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  });
  res.json({ success: true });
});

protectedDelete(router, "/api/v1/push/unsubscribe", { limiter: rateLimiter("push", 10), middleware: [validateBody(z.object({ endpoint: z.string().url().refine((url) => url.startsWith("https://") && checkSafeOutboundUrl(url).ok, { message: "Push endpoint must be an HTTPS URL and must not point to a local/private address" }) }))] }, async (req: ExpressRequest, res: Response) => {
  const userId = getUserId(req);
  const { endpoint } = req.body as { endpoint: string };
  await storage.push.removeSubscription(userId, endpoint);
  res.json({ success: true });
});


// Native app installs. The app registers on every launch and whenever FCM
// rotates its token, which also refreshes last_seen_at; it unregisters on
// sign-out. Refused when native push is not configured, so the app can tell
// the athlete notifications are unavailable instead of silently never
// delivering any.
protectedPost(router, "/api/v1/push/devices", { limiter: rateLimiter("push", 10), middleware: [validateBody(registerDeviceTokenSchema)] }, async (req: ExpressRequest, res: Response) => {
  if (!isNativePushEnabled()) {
    res.status(404).json({ error: "Push notifications not configured", code: "PUSH_NOT_CONFIGURED" });
    return;
  }
  const userId = getUserId(req);
  const { token, platform } = req.body as RegisterDeviceTokenInput;
  await storage.push.saveDeviceToken(userId, { token, platform, appVersion: readAppClient(req)?.version ?? null });
  res.json({ success: true });
});

protectedDelete(router, "/api/v1/push/devices", { limiter: rateLimiter("push", 10), middleware: [validateBody(unregisterDeviceTokenSchema)] }, async (req: ExpressRequest, res: Response) => {
  const userId = getUserId(req);
  const { token } = req.body as UnregisterDeviceTokenInput;
  await storage.push.removeDeviceToken(userId, token);
  res.json({ success: true });
});

protectedPost(router, "/api/v1/push/test", { limiter: rateLimiter("push", 5) }, async (req: ExpressRequest, res: Response) => {
  const userId = getUserId(req);
  const sent = await sendPushToUser(userId, {
    title: "Test Notification",
    body: "Push notifications are working!",
    url: "/",
  });
  res.json({ success: true, sent });
});

export default router;
