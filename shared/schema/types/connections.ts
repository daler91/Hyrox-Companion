import { garminConnections, stravaConnections } from "../tables";
import { createInsertSchema, z } from "../zod";
// Strava connection types and schemas
export const insertStravaConnectionSchema = createInsertSchema(stravaConnections).omit({
  id: true,
  createdAt: true,
});

export type InsertStravaConnection = z.infer<typeof insertStravaConnectionSchema>;
export type StravaConnection = typeof stravaConnections.$inferSelect;

// Garmin connection types and schemas. The insert schema validates the
// pre-encryption inputs (raw email/password/token JSON) — encryption happens
// inside the storage layer just like Strava.
export const insertGarminConnectionSchema = createInsertSchema(garminConnections).omit({
  id: true,
  createdAt: true,
});

export type InsertGarminConnection = z.infer<typeof insertGarminConnectionSchema>;
export type GarminConnection = typeof garminConnections.$inferSelect;

