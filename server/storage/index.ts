import { AiUsageStorage } from "./aiUsage";
import { AnalyticsStorage } from "./analytics";
import { AnalyticsResultsStorage } from "./analyticsResults";
import { AthleteFactsStorage } from "./athleteFacts";
import { CoachingStorage } from "./coaching";
import { ConsentStorage } from "./consent";
import { DataExportStorage } from "./dataExport";
import { IdempotencyStorage } from "./idempotency";
import type { IStorage } from "./IStorage";
import { MafTestStorage } from "./mafTests";
import { NutritionStorage } from "./nutrition";
import { PlanDayMovesStorage } from "./planDayMoves";
import { PlanProposalStorage } from "./planProposals";
import { PlanStorage } from "./plans";
import { PushStorage } from "./push";
import { RecycleBinStorage } from "./recycleBin";
import { SessionStreamStorage } from "./sessionStreams";
import { TimelineStorage } from "./timeline";
import { TimelineAnnotationsStorage } from "./timelineAnnotations";
import { UserStorage } from "./users";
import { WeeklyReviewsStorage } from "./weeklyReviews";
import { WorkoutStorage } from "./workouts";

export type { IStorage } from "./IStorage";

const workouts = new WorkoutStorage();

export const storage: IStorage = {
  users: new UserStorage(),
  workouts,
  plans: new PlanStorage(),
  planProposals: new PlanProposalStorage(),
  planDayMoves: new PlanDayMovesStorage(),
  timeline: new TimelineStorage(workouts),
  timelineAnnotations: new TimelineAnnotationsStorage(),
  athleteFacts: new AthleteFactsStorage(),
  analytics: new AnalyticsStorage(),
  analyticsResults: new AnalyticsResultsStorage(),
  coaching: new CoachingStorage(),
  idempotency: new IdempotencyStorage(),
  aiUsage: new AiUsageStorage(),
  push: new PushStorage(),
  mafTests: new MafTestStorage(),
  consent: new ConsentStorage(),
  nutrition: new NutritionStorage(),
  weeklyReviews: new WeeklyReviewsStorage(),
  recycleBin: new RecycleBinStorage(),
  sessionStreams: new SessionStreamStorage(),
  dataExport: new DataExportStorage(),
};
