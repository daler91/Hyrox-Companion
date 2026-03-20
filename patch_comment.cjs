const fs = require('fs');
const file = 'server/storage/workouts.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  `    if (log.planDayId) {
      await db
        .update(planDays)`,
  `    if (log.planDayId) {
      // Bolt Optimization: Use direct JOIN via .from() instead of inArray() subquery to prevent N+1 execution
      await db
        .update(planDays)`
);

code = code.replace(
  `      if (planDayIds.length > 0) {
        await db
          .update(planDays)`,
  `      if (planDayIds.length > 0) {
        // Bolt Optimization: Use direct JOIN via .from() instead of inArray() subquery to prevent N+1 execution
        await db
          .update(planDays)`
);

fs.writeFileSync(file, code);
