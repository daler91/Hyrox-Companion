import { clerkClient,clerkMiddleware, getAuth } from "@clerk/express";
import type { Express, RequestHandler } from "express";

import { env } from "./env";
import { logger } from "./logger";
import { storage } from "./storage";

export const DEV_USER_ID = "dev-user";

function isDev(): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

function isDevBypassEnabled(): boolean {
  // 🛡️ Sentinel: Double guard to prevent bypass in production
  if (env.NODE_ENV === "production") return false;
  return isDev() && env.ALLOW_DEV_AUTH_BYPASS === "true";
}

function hasClerkKeys(): boolean {
  return !!(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
}

async function ensureDevUserExists(): Promise<void> {
  const existing = await storage.users.getUser(DEV_USER_ID);
  if (existing) return;
  await storage.users.upsertUser({
    id: DEV_USER_ID,
    email: "dev@localhost",
    firstName: "Dev",
    lastName: "User",
    profileImageUrl: null,
  });
}

export async function setupAuth(app: Express) {
  // Drive "trust proxy" from validated env config so req.ip is not derived
  // from attacker-controlled forwarded headers in misconfigured deployments
  // (CODEBASE_AUDIT.md §2).
  let trustProxy: boolean | string | number = 1;
  if (env.TRUST_PROXY === "0") {
    trustProxy = false;
  } else if (env.TRUST_PROXY === "loopback") {
    trustProxy = "loopback";
  }
  app.set("trust proxy", trustProxy);

  if (hasClerkKeys()) {
    app.use(clerkMiddleware());
  } else if (isDevBypassEnabled()) {
    logger.info("[DEV] No Clerk keys found — using dev auth bypass");
    await ensureDevUserExists();
  } else {
    throw new Error(
      "Missing Clerk environment variables. Please set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.",
    );
  }

  if (isDevBypassEnabled()) {
    await ensureDevUserExists();
    logger.info("[DEV] Dev auth fallback enabled for iframe/preview contexts");
  }
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises
export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (hasClerkKeys()) {
    const auth = getAuth(req);
    if (auth?.userId) {
      try {
        await ensureUserExists(auth.userId);
      } catch (error) {
        logger.error({ err: error }, "Error syncing user:");
        return res.status(500).json({ error: "Failed to initialize user session", code: "INTERNAL_SERVER_ERROR" });
      }
      return next();
    }
    // Log coarse auth failure signals only. We intentionally do NOT log the
    // set of cookie key names — exposing internal cookie inventory in logs
    // widens the attack surface for anyone who can read observability
    // pipelines (CODEBASE_AUDIT.md §2, Low severity).
    logger.debug({
      path: req.path,
      hasCookie: !!req.headers.cookie,
      hasAuthHeader: !!req.headers.authorization,
      clerkUserIdPresent: !!auth?.userId,
    }, "Clerk auth failed");
  }

  if (isDevBypassEnabled() && req.headers["x-test-no-bypass"] !== "true") {
    try {
      await ensureDevUserExists();
    } catch (error) {
      logger.error({ err: error }, "Error creating dev user:");
      return res.status(500).json({ error: "Failed to initialize dev user session", code: "INTERNAL_SERVER_ERROR" });
    }
    return next();
  }

  return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
};

async function ensureUserExists(clerkUserId: string): Promise<void> {
  const existing = await storage.users.getUser(clerkUserId);
  if (existing) return;

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = clerkUser.emailAddresses?.[0]?.emailAddress || null;

  await storage.users.upsertUser({
    id: clerkUserId,
    email,
    firstName: clerkUser.firstName,
    lastName: clerkUser.lastName,
    profileImageUrl: clerkUser.imageUrl,
  });
}
