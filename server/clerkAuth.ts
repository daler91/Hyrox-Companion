import { logger } from "./logger";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { users, trainingPlans, workoutLogs, customExercises, chatMessages, stravaConnections } from "@shared/schema";
import { eq } from "drizzle-orm";

export const DEV_USER_ID = "dev-user";

function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

function hasClerkKeys(): boolean {
  return !!(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
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
  } else if (isDev()) {
    logger.info("[DEV] No Clerk keys found — using dev auth bypass");
    await ensureDevUserExists();
  } else {
    throw new Error(
      "Missing Clerk environment variables. Please set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.",
    );
  }

  if (isDev()) {
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
        return res.status(500).json({ message: "Failed to initialize user session" });
      }
      return next();
    }
  }

  if (isDev()) {
    try {
      await ensureDevUserExists();
    } catch (error) {
      logger.error({ err: error }, "Error creating dev user:");
      return res.status(500).json({ message: "Failed to initialize dev user session" });
    }
    return next();
  }

  return res.status(401).json({ message: "Unauthorized" });
};

async function ensureUserExists(clerkUserId: string): Promise<void> {
  const existing = await storage.getUser(clerkUserId);
  if (existing) return;

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = clerkUser.emailAddresses?.[0]?.emailAddress || null;

  if (email) {
    const existingByEmail = await db.select().from(users).where(eq(users.email, email));
    if (existingByEmail.length > 0 && existingByEmail[0].id !== clerkUserId) {
      const oldId = existingByEmail[0].id;
      await migrateUserId(oldId, clerkUserId);
      return;
    }
  }

  await storage.upsertUser({
    id: clerkUserId,
    email,
    firstName: clerkUser.firstName,
    lastName: clerkUser.lastName,
    profileImageUrl: clerkUser.imageUrl,
  });
}

async function migrateUserId(oldId: string, newId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [oldUser] = await tx.select().from(users).where(eq(users.id, oldId));
    if (!oldUser) throw new Error(`User ${oldId} not found for migration`);

    await tx.update(users).set({ email: null }).where(eq(users.id, oldId));

    await tx.insert(users).values({
      id: newId,
      email: oldUser.email,
      firstName: oldUser.firstName,
      lastName: oldUser.lastName,
      profileImageUrl: oldUser.profileImageUrl,
      weightUnit: oldUser.weightUnit,
      distanceUnit: oldUser.distanceUnit,
      weeklyGoal: oldUser.weeklyGoal,
      emailNotifications: oldUser.emailNotifications,
      updatedAt: new Date(),
    });

    await Promise.all([
      tx.update(trainingPlans).set({ userId: newId }).where(eq(trainingPlans.userId, oldId)),
      tx.update(workoutLogs).set({ userId: newId }).where(eq(workoutLogs.userId, oldId)),
      tx.update(customExercises).set({ userId: newId }).where(eq(customExercises.userId, oldId)),
      tx.update(chatMessages).set({ userId: newId }).where(eq(chatMessages.userId, oldId)),
      tx.update(stravaConnections).set({ userId: newId }).where(eq(stravaConnections.userId, oldId)),
    ]);

    await tx.delete(users).where(eq(users.id, oldId));
  });
}
