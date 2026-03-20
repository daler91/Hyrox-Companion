import { db } from "./server/db";
import { planDays, trainingPlans, workoutLogs, exerciseSets } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

async function test() {
  const query = db
    .update(planDays)
    .set({ status: "completed" })
    .where(
      and(
        eq(planDays.id, "123"),
        inArray(
          planDays.planId,
          db.select({ id: trainingPlans.id })
            .from(trainingPlans)
            .where(eq(trainingPlans.userId, "user1"))
        )
      )
    );
  console.log("nested query constructed:", query.toSQL());
}
test().catch(console.error);
