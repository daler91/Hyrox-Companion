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

const sqlChunks = [];
sqlChunks.push(sql`CASE "${sql.raw(planDays.id.name)}" `);
for (const u of dateUpdates) {
  sqlChunks.push(sql`WHEN ${u.id} THEN ${u.scheduledDate}::date `);
}
sqlChunks.push(sql`END`);
const caseSql = sql.join(sqlChunks, sql``);

console.log(caseSql);
