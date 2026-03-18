import { sql, inArray } from "drizzle-orm";
import { pgTable, varchar, date } from "drizzle-orm/pg-core";

const planDays = pgTable("plan_days", {
  id: varchar("id").primaryKey(),
  scheduledDate: date("scheduled_date")
});

const dateUpdates = [
  { id: '1', scheduledDate: '2023-01-01', resetStatus: true },
  { id: '2', scheduledDate: '2023-01-02', resetStatus: false }
];

const updateIds = dateUpdates.map(u => u.id);

const caseChunks = [];
caseChunks.push(sql`CASE "${sql.raw(planDays.id.name)}" `);
for (const u of dateUpdates) {
  caseChunks.push(sql`WHEN ${u.id} THEN ${u.scheduledDate}::date `);
}
caseChunks.push(sql`END`);
const caseSql = sql.join(caseChunks, sql``);

console.log("update object to use in drizzle .set()");
console.log({ scheduledDate: caseSql });
