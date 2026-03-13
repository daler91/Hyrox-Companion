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
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserPreferences(userId: string, preferences: UpdateUserPreferences): Promise<User | undefined>;

  createTrainingPlan(plan: InsertTrainingPlan): Promise<TrainingPlan>;
  listTrainingPlans(userId: string): Promise<TrainingPlan[]>;
  getTrainingPlan(planId: string, userId: string): Promise<TrainingPlanWithDays | undefined>;
  renameTrainingPlan(planId: string, name: string, userId: string): Promise<TrainingPlan | undefined>;
  deleteTrainingPlan(planId: string, userId: string): Promise<boolean>;

  createPlanDays(days: InsertPlanDay[]): Promise<PlanDay[]>;
  updatePlanDay(dayId: string, updates: UpdatePlanDay, userId: string): Promise<PlanDay | undefined>;
  getPlanDay(dayId: string, userId: string): Promise<PlanDay | undefined>;
  deletePlanDay(dayId: string, userId: string): Promise<boolean>;
  schedulePlan(planId: string, startDate: string, userId: string): Promise<boolean>;

  createWorkoutLog(log: InsertWorkoutLog & { userId: string }): Promise<WorkoutLog>;
  listWorkoutLogs(userId: string): Promise<WorkoutLog[]>;
  getWorkoutLog(logId: string, userId: string): Promise<WorkoutLog | undefined>;
  updateWorkoutLog(logId: string, updates: UpdateWorkoutLog, userId: string): Promise<WorkoutLog | undefined>;
  deleteWorkoutLog(logId: string, userId: string): Promise<boolean>;
  deleteWorkoutLogByPlanDayId(planDayId: string, userId: string): Promise<boolean>;
  getWorkoutLogByPlanDayId(planDayId: string, userId: string): Promise<WorkoutLog | undefined>;

  getTimeline(userId: string, planId?: string): Promise<TimelineEntry[]>;

  getChatMessages(userId: string): Promise<ChatMessage[]>;
  saveChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  clearChatHistory(userId: string): Promise<boolean>;

  getStravaConnection(userId: string): Promise<StravaConnection | undefined>;
  upsertStravaConnection(data: InsertStravaConnection): Promise<StravaConnection>;
  deleteStravaConnection(userId: string): Promise<boolean>;
  updateStravaLastSync(userId: string): Promise<void>;
  getWorkoutByStravaActivityId(userId: string, stravaActivityId: string): Promise<WorkoutLog | undefined>;

  createExerciseSets(sets: InsertExerciseSet[]): Promise<ExerciseSet[]>;
  getExerciseSetsByWorkoutLog(workoutLogId: string): Promise<ExerciseSet[]>;
  getExerciseSetsByWorkoutLogs(workoutLogIds: string[]): Promise<ExerciseSet[]>;
  deleteExerciseSetsByWorkoutLog(workoutLogId: string, userId: string): Promise<boolean>;
  getExerciseHistory(userId: string, exerciseName: string): Promise<(ExerciseSet & { date: string })[]>;

  getCustomExercises(userId: string): Promise<CustomExercise[]>;
  upsertCustomExercise(data: InsertCustomExercise): Promise<CustomExercise>;
  upsertCustomExercises(data: InsertCustomExercise[]): Promise<CustomExercise[]>;

  getWorkoutsWithoutExerciseSets(userId: string): Promise<WorkoutLog[]>;
  getAllExerciseSetsWithDates(userId: string, from?: string, to?: string): Promise<(ExerciseSet & { date: string })[]>;

  updateLastWeeklySummaryAt(userId: string): Promise<void>;
  updateLastMissedReminderAt(userId: string): Promise<void>;
  getUsersWithEmailNotifications(): Promise<User[]>;
  markMissedPlanDays(): Promise<number>;
  getMissedWorkoutsForDate(userId: string, date: string): Promise<{ date: string; focus: string; mainWorkout: string; planName?: string }[]>;
  getWeeklyStats(userId: string, weekStart: string, weekEnd: string): Promise<{ completedCount: number; plannedCount: number; missedCount: number; skippedCount: number; totalDuration: number }>;
}
