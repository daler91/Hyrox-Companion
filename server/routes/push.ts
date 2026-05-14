import { type Request as ExpressRequest, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { env } from "../env";
import { isPushEnabled, sendPushToUser } from "../pushNotifications";
import { rateLimiter, validateBody } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";
import { protectedDelete, protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

const subscribeSchema = z.object({
  // 🛡️ Sentinel: Enforce HTTPS to prevent SSRF against internal/local services
  endpoint: z.string().url().refine((url) => url.startsWith("https://"), {
    message: "Push endpoint must be an HTTPS URL",
  }),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

router.get("/api/v1/push/vapid-key", isAuthenticated, (_req: ExpressRequest, res: Response) => {
  if (!isPushEnabled()) {
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

protectedDelete(router, "/api/v1/push/unsubscribe", { limiter: rateLimiter("push", 10), middleware: [validateBody(z.object({ endpoint: z.string().url().refine((url) => url.startsWith("https://"), { message: "Push endpoint must be an HTTPS URL" }) }))] }, async (req: ExpressRequest, res: Response) => {
  const userId = getUserId(req);
  const { endpoint } = req.body as { endpoint: string };
  await storage.push.removeSubscription(userId, endpoint);
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
