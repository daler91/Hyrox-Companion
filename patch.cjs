const fs = require('fs');
const file = 'server/storage/workouts.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  `        .update(planDays)
        .set({ status: "completed" })
        .where(
          and(
            eq(planDays.id, log.planDayId),
            inArray(
              planDays.planId,
              db.select({ id: trainingPlans.id })
                .from(trainingPlans)
                .where(eq(trainingPlans.userId, log.userId))
            )
          )
        );`,
  `        .update(planDays)
        .set({ status: "completed" })
        .from(trainingPlans)
        .where(
          and(
            eq(planDays.id, log.planDayId),
            eq(planDays.planId, trainingPlans.id),
            eq(trainingPlans.userId, log.userId)
          )
        );`
);

code = code.replace(
  `          .update(planDays)
          .set({ status: "completed" })
          .where(
            and(
              inArray(planDays.id, planDayIds),
              inArray(
                planDays.planId,
                db.select({ id: trainingPlans.id })
                  .from(trainingPlans)
                  .where(eq(trainingPlans.userId, userId))
              )
            )
          );`,
  `          .update(planDays)
          .set({ status: "completed" })
          .from(trainingPlans)
          .where(
            and(
              inArray(planDays.id, planDayIds),
              eq(planDays.planId, trainingPlans.id),
              eq(trainingPlans.userId, userId)
            )
          );`
);

fs.writeFileSync(file, code);
