import { env } from "./env";
import { logger } from "./logger";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";

export const DEV_USER_ID = "dev-user";

function isDev(): boolean {
  return env.NODE_ENV === "development";
}

function isDevBypassEnabled(): boolean {
  return isDev() && env.ALLOW_DEV_AUTH_BYPASS === "true";
}

function hasClerkKeys(): boolean {
  return !!(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
}

async function ensureDevUserExists(): Promise<void> {
  const existing = await storage.getUser(DEV_USER_ID);
  if (existing) return;
  await storage.upsertUser({
    id: DEV_USER_ID,
    email: "dev@localhost",
    firstName: "Dev",
    lastName: "User",
    profileImageUrl: null,
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);

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

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (hasClerkKeys()) {
    const auth = getAuth(req);
    if (auth?.userId) {
      try {
        await ensureUserExists(auth.userId);
      } catch (error) {
        logger.error({ err: error }, "Error syncing user:");
        return res.status(500).json({ error: "Failed to initialize user session" });
      }
      return next();
    }
  }

  if (isDevBypassEnabled()) {
    try {
      await ensureDevUserExists();
    } catch (error) {
      logger.error({ err: error }, "Error creating dev user:");
      return res.status(500).json({ error: "Failed to initialize dev user session" });
    }
    return next();
  }

  return res.status(401).json({ error: "Unauthorized" });
};

async function ensureUserExists(clerkUserId: string): Promise<void> {
  const existing = await storage.getUser(clerkUserId);
  if (existing) return;

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = clerkUser.emailAddresses?.[0]?.emailAddress || null;

  await storage.upsertUser({
    id: clerkUserId,
    email,
    firstName: clerkUser.firstName,
    lastName: clerkUser.lastName,
    profileImageUrl: clerkUser.imageUrl,
  });
}
