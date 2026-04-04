import type { IStorage } from "./IStorage";
import { UserStorage } from "./users";
import { WorkoutStorage } from "./workouts";
import { PlanStorage } from "./plans";
import { TimelineStorage } from "./timeline";
import { AnalyticsStorage } from "./analytics";
import { CoachingStorage } from "./coaching";

export type { IStorage } from "./IStorage";

type AssertAllKeys<T, U extends Record<keyof T, unknown>> = U;

type DelegateUnion = UserStorage & WorkoutStorage & PlanStorage & TimelineStorage & AnalyticsStorage & CoachingStorage;

type _CheckCoverage = AssertAllKeys<IStorage, DelegateUnion>;

class DatabaseStorage implements IStorage {
  private readonly userStorage = new UserStorage();
  private readonly workoutStorage = new WorkoutStorage();
  private readonly planStorage = new PlanStorage();
  private readonly timelineStorage = new TimelineStorage(this.workoutStorage);
  private readonly analyticsStorage = new AnalyticsStorage();
  private readonly coachingStorage = new CoachingStorage();

  // ── IUserStorage ──────────────────────────────────────────────
  getUser: IStorage["getUser"] = (...args) => this.userStorage.getUser(...args);
  upsertUser: IStorage["upsertUser"] = (...args) => this.userStorage.upsertUser(...args);
  updateUserPreferences: IStorage["updateUserPreferences"] = (...args) => this.userStorage.updateUserPreferences(...args);
  updateIsAutoCoaching: IStorage["updateIsAutoCoaching"] = (...args) => this.userStorage.updateIsAutoCoaching(...args);

  // ── IChatStorage ──────────────────────────────────────────────
  getChatMessages: IStorage["getChatMessages"] = (...args) => this.userStorage.getChatMessages(...args);
  saveChatMessage: IStorage["saveChatMessage"] = (...args) => this.userStorage.saveChatMessage(...args);
  clearChatHistory: IStorage["clearChatHistory"] = (...args) => this.userStorage.clearChatHistory(...args);

  // ── IIntegrationStorage ───────────────────────────────────────
  getStravaConnection: IStorage["getStravaConnection"] = (...args) => this.userStorage.getStravaConnection(...args);
  upsertStravaConnection: IStorage["upsertStravaConnection"] = (...args) => this.userStorage.upsertStravaConnection(...args);
  deleteStravaConnection: IStorage["deleteStravaConnection"] = (...args) => this.userStorage.deleteStravaConnection(...args);
  updateStravaLastSync: IStorage["updateStravaLastSync"] = (...args) => this.userStorage.updateStravaLastSync(...args);
  getWorkoutByStravaActivityId: IStorage["getWorkoutByStravaActivityId"] = (...args) => this.workoutStorage.getWorkoutByStravaActivityId(...args);
  getExistingStravaActivityIds: IStorage["getExistingStravaActivityIds"] = (...args) => this.workoutStorage.getExistingStravaActivityIds(...args);

  // ── INotificationStorage ──────────────────────────────────────
  updateLastWeeklySummaryAt: IStorage["updateLastWeeklySummaryAt"] = (...args) => this.userStorage.updateLastWeeklySummaryAt(...args);
  updateLastMissedReminderAt: IStorage["updateLastMissedReminderAt"] = (...args) => this.userStorage.updateLastMissedReminderAt(...args);
  getUsersWithEmailNotifications: IStorage["getUsersWithEmailNotifications"] = (...args) => this.userStorage.getUsersWithEmailNotifications(...args);
  markMissedPlanDays: IStorage["markMissedPlanDays"] = (...args) => this.planStorage.markMissedPlanDays(...args);
  getMissedWorkoutsForDate: IStorage["getMissedWorkoutsForDate"] = (...args) => this.analyticsStorage.getMissedWorkoutsForDate(...args);

  // ── IWorkoutStorage ───────────────────────────────────────────
  createWorkoutLog: IStorage["createWorkoutLog"] = (...args) => this.workoutStorage.createWorkoutLog(...args);
  createWorkoutLogs: IStorage["createWorkoutLogs"] = (...args) => this.workoutStorage.createWorkoutLogs(...args);
  listWorkoutLogs: IStorage["listWorkoutLogs"] = (...args) => this.workoutStorage.listWorkoutLogs(...args);
  getWorkoutLog: IStorage["getWorkoutLog"] = (...args) => this.workoutStorage.getWorkoutLog(...args);
  updateWorkoutLog: IStorage["updateWorkoutLog"] = (...args) => this.workoutStorage.updateWorkoutLog(...args);
  deleteWorkoutLog: IStorage["deleteWorkoutLog"] = (...args) => this.workoutStorage.deleteWorkoutLog(...args);
  deleteWorkoutLogByPlanDayId: IStorage["deleteWorkoutLogByPlanDayId"] = (...args) => this.workoutStorage.deleteWorkoutLogByPlanDayId(...args);
  getWorkoutLogByPlanDayId: IStorage["getWorkoutLogByPlanDayId"] = (...args) => this.workoutStorage.getWorkoutLogByPlanDayId(...args);
  createExerciseSets: IStorage["createExerciseSets"] = (...args) => this.workoutStorage.createExerciseSets(...args);
  getExerciseSetsByWorkoutLog: IStorage["getExerciseSetsByWorkoutLog"] = (...args) => this.workoutStorage.getExerciseSetsByWorkoutLog(...args);
  getExerciseSetsByWorkoutLogs: IStorage["getExerciseSetsByWorkoutLogs"] = (...args) => this.workoutStorage.getExerciseSetsByWorkoutLogs(...args);
  deleteExerciseSetsByWorkoutLog: IStorage["deleteExerciseSetsByWorkoutLog"] = (...args) => this.workoutStorage.deleteExerciseSetsByWorkoutLog(...args);
  getExerciseHistory: IStorage["getExerciseHistory"] = (...args) => this.workoutStorage.getExerciseHistory(...args);
  getCustomExercises: IStorage["getCustomExercises"] = (...args) => this.userStorage.getCustomExercises(...args);
  upsertCustomExercise: IStorage["upsertCustomExercise"] = (...args) => this.userStorage.upsertCustomExercise(...args);
  getWorkoutsWithoutExerciseSets: IStorage["getWorkoutsWithoutExerciseSets"] = (...args) => this.workoutStorage.getWorkoutsWithoutExerciseSets(...args);
  getAllExerciseSetsWithDates: IStorage["getAllExerciseSetsWithDates"] = (...args) => this.analyticsStorage.getAllExerciseSetsWithDates(...args);

  // ── IPlanStorage ──────────────────────────────────────────────
  createTrainingPlan: IStorage["createTrainingPlan"] = (...args) => this.planStorage.createTrainingPlan(...args);
  listTrainingPlans: IStorage["listTrainingPlans"] = (...args) => this.planStorage.listTrainingPlans(...args);
  getActivePlan: IStorage["getActivePlan"] = (...args) => this.planStorage.getActivePlan(...args);
  getPlanForDate: IStorage["getPlanForDate"] = (...args) => this.planStorage.getPlanForDate(...args);
  findMatchingPlanDay: IStorage["findMatchingPlanDay"] = (...args) => this.planStorage.findMatchingPlanDay(...args);
  getTrainingPlan: IStorage["getTrainingPlan"] = (...args) => this.planStorage.getTrainingPlan(...args);
  renameTrainingPlan: IStorage["renameTrainingPlan"] = (...args) => this.planStorage.renameTrainingPlan(...args);
  updateTrainingPlanGoal: IStorage["updateTrainingPlanGoal"] = (...args) => this.planStorage.updateTrainingPlanGoal(...args);
  deleteTrainingPlan: IStorage["deleteTrainingPlan"] = (...args) => this.planStorage.deleteTrainingPlan(...args);
  createPlanDays: IStorage["createPlanDays"] = (...args) => this.planStorage.createPlanDays(...args);
  updatePlanDay: IStorage["updatePlanDay"] = (...args) => this.planStorage.updatePlanDay(...args);
  getPlanDay: IStorage["getPlanDay"] = (...args) => this.planStorage.getPlanDay(...args);
  deletePlanDay: IStorage["deletePlanDay"] = (...args) => this.planStorage.deletePlanDay(...args);
  schedulePlan: IStorage["schedulePlan"] = (...args) => this.planStorage.schedulePlan(...args);

  // ── IAnalyticsStorage ─────────────────────────────────────────
  getTimeline: IStorage["getTimeline"] = (...args) => this.timelineStorage.getTimeline(...args);
  getUpcomingPlannedDays: IStorage["getUpcomingPlannedDays"] = (...args) => this.timelineStorage.getUpcomingPlannedDays(...args);
  getWeeklyStats: IStorage["getWeeklyStats"] = (...args) => this.analyticsStorage.getWeeklyStats(...args);
  getWorkoutLogsByDateRange: IStorage["getWorkoutLogsByDateRange"] = (...args) => this.analyticsStorage.getWorkoutLogsByDateRange(...args);

  // ── ICoachingStorage ──────────────────────────────────────────
  listCoachingMaterials: IStorage["listCoachingMaterials"] = (...args) => this.coachingStorage.listCoachingMaterials(...args);
  getCoachingMaterial: IStorage["getCoachingMaterial"] = (...args) => this.coachingStorage.getCoachingMaterial(...args);
  createCoachingMaterial: IStorage["createCoachingMaterial"] = (...args) => this.coachingStorage.createCoachingMaterial(...args);
  updateCoachingMaterial: IStorage["updateCoachingMaterial"] = (...args) => this.coachingStorage.updateCoachingMaterial(...args);
  deleteCoachingMaterial: IStorage["deleteCoachingMaterial"] = (...args) => this.coachingStorage.deleteCoachingMaterial(...args);
  insertChunks: IStorage["insertChunks"] = (...args) => this.coachingStorage.insertChunks(...args);
  deleteChunksByMaterialId: IStorage["deleteChunksByMaterialId"] = (...args) => this.coachingStorage.deleteChunksByMaterialId(...args);
  replaceChunks: IStorage["replaceChunks"] = (...args) => this.coachingStorage.replaceChunks(...args);
  searchChunksByEmbedding: IStorage["searchChunksByEmbedding"] = (...args) => this.coachingStorage.searchChunksByEmbedding(...args);
  getChunkCountsByMaterial: IStorage["getChunkCountsByMaterial"] = (...args) => this.coachingStorage.getChunkCountsByMaterial(...args);
  hasChunksForUser: IStorage["hasChunksForUser"] = (...args) => this.coachingStorage.hasChunksForUser(...args);
  getStoredEmbeddingDimension: IStorage["getStoredEmbeddingDimension"] = (...args) => this.coachingStorage.getStoredEmbeddingDimension(...args);
}

export const storage: IStorage = new DatabaseStorage();
