import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { users, trainingPlans, workoutLogs, customExercises, chatMessages, stravaConnections } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(clerkMiddleware());
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const auth = getAuth(req);

  if (!auth || !auth.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await ensureUserExists(auth.userId);
  } catch (error) {
    console.error("Error syncing user:", error);
    return res.status(500).json({ message: "Failed to initialize user session" });
  }

  return next();
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
      hyroxDivision: oldUser.hyroxDivision,
      fitnessLevel: oldUser.fitnessLevel,
      targetRaceDate: oldUser.targetRaceDate,
      personalBests: oldUser.personalBests,
      distanceUnit: oldUser.distanceUnit,
      updatedAt: new Date(),
    });

    await tx.update(trainingPlans).set({ userId: newId }).where(eq(trainingPlans.userId, oldId));
    await tx.update(workoutLogs).set({ userId: newId }).where(eq(workoutLogs.userId, oldId));
    await tx.update(customExercises).set({ userId: newId }).where(eq(customExercises.userId, oldId));
    await tx.update(chatMessages).set({ userId: newId }).where(eq(chatMessages.userId, oldId));
    await tx.update(stravaConnections).set({ userId: newId }).where(eq(stravaConnections.userId, oldId));

    await tx.delete(users).where(eq(users.id, oldId));
  });
  console.log(`Migrated user ID from ${oldId} to ${newId}`);
}
