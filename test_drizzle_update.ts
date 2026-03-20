import { db } from "./server/db";
import { planDays, trainingPlans, workoutLogs, exerciseSets } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

async function test() {
  const query = db
    .update(planDays)
    .set({ status: "completed" })
    .from(trainingPlans)
    .where(
      and(
        eq(planDays.id, "123"),
        eq(planDays.planId, trainingPlans.id),
        eq(trainingPlans.userId, "456")
      )
    );
  console.log("query constructed:", query.toSQL());

  const query2 = db
    .update(planDays)
    .set({ status: "completed" })
    .from(trainingPlans)
    .where(
      and(
        inArray(planDays.id, ["1", "2"]),
        eq(planDays.planId, trainingPlans.id),
        eq(trainingPlans.userId, "user1")
      )
    );
  console.log("query2 constructed:", query2.toSQL());
}
test().catch(console.error);
