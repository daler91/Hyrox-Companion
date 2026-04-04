import type {
  User,
  UpsertUser,
  TrainingPlan,
  InsertTrainingPlan,
  PlanDay,
  InsertPlanDay,
  UpdatePlanDay,
  TrainingPlanWithDays,
  WorkoutLog,
  InsertWorkoutLog,
  UpdateWorkoutLog,
  TimelineEntry,
  UpdateUserPreferences,
  ChatMessage,
  InsertChatMessage,
  StravaConnection,
  InsertStravaConnection,
  ExerciseSet,
  InsertExerciseSet,
  CustomExercise,
  InsertCustomExercise,
  CoachingMaterial,
  InsertCoachingMaterial,
  DocumentChunk,
  InsertDocumentChunk,
} from "@shared/schema";

export interface IUserStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserPreferences(userId: string, preferences: UpdateUserPreferences): Promise<User | undefined>;
  updateIsAutoCoaching(userId: string, isAutoCoaching: boolean): Promise<void>;
}

export interface IPlanStorage {
  createTrainingPlan(plan: InsertTrainingPlan): Promise<TrainingPlan>;
  listTrainingPlans(userId: string): Promise<TrainingPlan[]>;
  getActivePlan(userId: string): Promise<TrainingPlan | undefined>;
  getPlanForDate(userId: string, date: string): Promise<TrainingPlan | undefined>;
  findMatchingPlanDay(planId: string, date: string): Promise<PlanDay | undefined>;
  getTrainingPlan(planId: string, userId: string): Promise<TrainingPlanWithDays | undefined>;
  renameTrainingPlan(planId: string, name: string, userId: string): Promise<TrainingPlan | undefined>;
  updateTrainingPlanGoal(planId: string, goal: string | null, userId: string): Promise<TrainingPlan | undefined>;
  deleteTrainingPlan(planId: string, userId: string): Promise<boolean>;

  createPlanDays(days: InsertPlanDay[]): Promise<PlanDay[]>;
  updatePlanDay(dayId: string, updates: UpdatePlanDay, userId: string): Promise<PlanDay | undefined>;
  getPlanDay(dayId: string, userId: string): Promise<PlanDay | undefined>;
  deletePlanDay(dayId: string, userId: string): Promise<boolean>;
  schedulePlan(planId: string, startDate: string, userId: string): Promise<boolean>;
}

export interface IWorkoutStorage {
  createWorkoutLog(log: InsertWorkoutLog & { userId: string }): Promise<WorkoutLog>;
  createWorkoutLogs(logs: (InsertWorkoutLog & { userId: string })[]): Promise<WorkoutLog[]>;
  listWorkoutLogs(userId: string, limit?: number, offset?: number): Promise<WorkoutLog[]>;
  getWorkoutLog(logId: string, userId: string): Promise<WorkoutLog | undefined>;
  updateWorkoutLog(logId: string, updates: UpdateWorkoutLog, userId: string): Promise<WorkoutLog | undefined>;
  deleteWorkoutLog(logId: string, userId: string): Promise<boolean>;
  deleteWorkoutLogByPlanDayId(planDayId: string, userId: string): Promise<boolean>;
  getWorkoutLogByPlanDayId(planDayId: string, userId: string): Promise<WorkoutLog | undefined>;

  createExerciseSets(sets: InsertExerciseSet[]): Promise<ExerciseSet[]>;
  getExerciseSetsByWorkoutLog(workoutLogId: string): Promise<ExerciseSet[]>;
  getExerciseSetsByWorkoutLogs(workoutLogIds: string[]): Promise<ExerciseSet[]>;
  deleteExerciseSetsByWorkoutLog(workoutLogId: string, userId: string): Promise<boolean>;
  getExerciseHistory(userId: string, exerciseName: string): Promise<(ExerciseSet & { date: string })[]>;

  getCustomExercises(userId: string): Promise<CustomExercise[]>;
  upsertCustomExercise(data: InsertCustomExercise): Promise<CustomExercise>;

  getWorkoutsWithoutExerciseSets(userId: string): Promise<WorkoutLog[]>;
  getAllExerciseSetsWithDates(userId: string, from?: string, to?: string): Promise<(ExerciseSet & { date: string })[]>;
}

export interface IAnalyticsStorage {
  getTimeline(userId: string, planId?: string, limit?: number, offset?: number): Promise<TimelineEntry[]>;
  getUpcomingPlannedDays(userId: string, limit: number): Promise<Array<{ planDayId: string; date: string; focus: string; mainWorkout: string; accessory: string | null; notes: string | null }>>;
  getWeeklyStats(userId: string, weekStart: string, weekEnd: string): Promise<{ completedCount: number; plannedCount: number; missedCount: number; skippedCount: number; totalDuration: number }>;
  getWorkoutLogsByDateRange(userId: string, from?: string, to?: string): Promise<WorkoutLog[]>;
}

export interface IChatStorage {
  getChatMessages(userId: string): Promise<ChatMessage[]>;
  saveChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  clearChatHistory(userId: string): Promise<boolean>;
}

export interface IIntegrationStorage {
  getStravaConnection(userId: string): Promise<StravaConnection | undefined>;
  upsertStravaConnection(data: InsertStravaConnection): Promise<StravaConnection>;
  deleteStravaConnection(userId: string): Promise<boolean>;
  updateStravaLastSync(userId: string): Promise<void>;
  getWorkoutByStravaActivityId(userId: string, stravaActivityId: string): Promise<WorkoutLog | undefined>;
  getExistingStravaActivityIds(userId: string, stravaActivityIds: string[]): Promise<string[]>;
}

export interface INotificationStorage {
  updateLastWeeklySummaryAt(userId: string): Promise<void>;
  updateLastMissedReminderAt(userId: string): Promise<void>;
  getUsersWithEmailNotifications(): Promise<User[]>;
  markMissedPlanDays(): Promise<number>;
  getMissedWorkoutsForDate(userId: string, date: string): Promise<{ date: string; focus: string; mainWorkout: string; planName?: string }[]>;
}

export interface ICoachingStorage {
  listCoachingMaterials(userId: string): Promise<CoachingMaterial[]>;
  getCoachingMaterial(id: string, userId: string): Promise<CoachingMaterial | undefined>;
  createCoachingMaterial(data: InsertCoachingMaterial): Promise<CoachingMaterial>;
  updateCoachingMaterial(id: string, updates: Partial<Pick<CoachingMaterial, "title" | "content" | "type">>, userId: string): Promise<CoachingMaterial | undefined>;
  deleteCoachingMaterial(id: string, userId: string): Promise<boolean>;

  // RAG chunk methods
  insertChunks(chunks: InsertDocumentChunk[]): Promise<DocumentChunk[]>;
  deleteChunksByMaterialId(materialId: string): Promise<void>;
  replaceChunks(materialId: string, chunks: InsertDocumentChunk[]): Promise<DocumentChunk[]>;
  searchChunksByEmbedding(userId: string, queryEmbedding: number[], topK: number): Promise<DocumentChunk[]>;
  getChunkCountsByMaterial(userId: string): Promise<{ materialId: string; chunkCount: number; hasEmbeddings: boolean }[]>;
  hasChunksForUser(userId: string): Promise<boolean>;
  getStoredEmbeddingDimension(userId: string): Promise<number | null>;
}

export interface IStorage extends IUserStorage, IPlanStorage, IWorkoutStorage, IAnalyticsStorage, IChatStorage, IIntegrationStorage, INotificationStorage, ICoachingStorage {}
