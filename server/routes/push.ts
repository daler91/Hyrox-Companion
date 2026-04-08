import { type Request as ExpressRequest, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { env } from "../env";
import { isPushEnabled, sendPushToUser } from "../pushNotifications";
import { asyncHandler, rateLimiter, validateBody } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

const subscribeSchema = z.object({
  endpoint: z.string().url(),
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

router.post("/api/v1/push/subscribe", isAuthenticated, rateLimiter("push", 10), validateBody(subscribeSchema), asyncHandler(async (req: ExpressRequest, res: Response) => {
  const userId = getUserId(req);
  const { endpoint, keys } = req.body as z.infer<typeof subscribeSchema>;
  await storage.push.saveSubscription(userId, {
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  });
  res.json({ success: true });
}));

router.delete("/api/v1/push/unsubscribe", isAuthenticated, rateLimiter("push", 10), validateBody(z.object({ endpoint: z.string().url() })), asyncHandler(async (req: ExpressRequest, res: Response) => {
  const userId = getUserId(req);
  const { endpoint } = req.body as { endpoint: string };
  await storage.push.removeSubscription(userId, endpoint);
  res.json({ success: true });
}));

router.post("/api/v1/push/test", isAuthenticated, rateLimiter("push", 5), asyncHandler(async (req: ExpressRequest, res: Response) => {
  const userId = getUserId(req);
  const sent = await sendPushToUser(userId, {
    title: "Test Notification",
    body: "Push notifications are working!",
    url: "/",
  });
  res.json({ success: true, sent });
}));

export default router;
