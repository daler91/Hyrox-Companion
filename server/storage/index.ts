import type { IStorage } from "./IStorage";
import { UserStorage } from "./users";
import { WorkoutStorage } from "./workouts";
import { PlanStorage } from "./plans";
import { TimelineStorage } from "./timeline";
import { AnalyticsStorage } from "./analytics";

export type { IStorage } from "./IStorage";

class DatabaseStorage implements IStorage {
  private userStorage = new UserStorage();
  private workoutStorage = new WorkoutStorage();
  private planStorage = new PlanStorage();
  private timelineStorage = new TimelineStorage(this.workoutStorage);
  private analyticsStorage = new AnalyticsStorage();

  getUser = this.userStorage.getUser.bind(this.userStorage);
  upsertUser = this.userStorage.upsertUser.bind(this.userStorage);
  updateUserPreferences = this.userStorage.updateUserPreferences.bind(this.userStorage);
  getChatMessages = this.userStorage.getChatMessages.bind(this.userStorage);
  saveChatMessage = this.userStorage.saveChatMessage.bind(this.userStorage);
  clearChatHistory = this.userStorage.clearChatHistory.bind(this.userStorage);
  getStravaConnection = this.userStorage.getStravaConnection.bind(this.userStorage);
  upsertStravaConnection = this.userStorage.upsertStravaConnection.bind(this.userStorage);
  deleteStravaConnection = this.userStorage.deleteStravaConnection.bind(this.userStorage);
  updateStravaLastSync = this.userStorage.updateStravaLastSync.bind(this.userStorage);
  getCustomExercises = this.userStorage.getCustomExercises.bind(this.userStorage);
  upsertCustomExercise = this.userStorage.upsertCustomExercise.bind(this.userStorage);
  updateLastWeeklySummaryAt = this.userStorage.updateLastWeeklySummaryAt.bind(this.userStorage);
  updateLastMissedReminderAt = this.userStorage.updateLastMissedReminderAt.bind(this.userStorage);
  getUsersWithEmailNotifications = this.userStorage.getUsersWithEmailNotifications.bind(this.userStorage);

  createWorkoutLog = this.workoutStorage.createWorkoutLog.bind(this.workoutStorage);
  listWorkoutLogs = this.workoutStorage.listWorkoutLogs.bind(this.workoutStorage);
  getWorkoutLog = this.workoutStorage.getWorkoutLog.bind(this.workoutStorage);
  updateWorkoutLog = this.workoutStorage.updateWorkoutLog.bind(this.workoutStorage);
  deleteWorkoutLog = this.workoutStorage.deleteWorkoutLog.bind(this.workoutStorage);
  deleteWorkoutLogByPlanDayId = this.workoutStorage.deleteWorkoutLogByPlanDayId.bind(this.workoutStorage);
  getWorkoutLogByPlanDayId = this.workoutStorage.getWorkoutLogByPlanDayId.bind(this.workoutStorage);
  getWorkoutByStravaActivityId = this.workoutStorage.getWorkoutByStravaActivityId.bind(this.workoutStorage);
  getWorkoutsByStravaActivityIds = this.workoutStorage.getWorkoutsByStravaActivityIds.bind(this.workoutStorage);
  createExerciseSets = this.workoutStorage.createExerciseSets.bind(this.workoutStorage);
  getExerciseSetsByWorkoutLog = this.workoutStorage.getExerciseSetsByWorkoutLog.bind(this.workoutStorage);
  getExerciseSetsByWorkoutLogs = this.workoutStorage.getExerciseSetsByWorkoutLogs.bind(this.workoutStorage);
  deleteExerciseSetsByWorkoutLog = this.workoutStorage.deleteExerciseSetsByWorkoutLog.bind(this.workoutStorage);
  getExerciseHistory = this.workoutStorage.getExerciseHistory.bind(this.workoutStorage);
  getWorkoutsWithoutExerciseSets = this.workoutStorage.getWorkoutsWithoutExerciseSets.bind(this.workoutStorage);

  createTrainingPlan = this.planStorage.createTrainingPlan.bind(this.planStorage);
  listTrainingPlans = this.planStorage.listTrainingPlans.bind(this.planStorage);
  getTrainingPlan = this.planStorage.getTrainingPlan.bind(this.planStorage);
  renameTrainingPlan = this.planStorage.renameTrainingPlan.bind(this.planStorage);
  deleteTrainingPlan = this.planStorage.deleteTrainingPlan.bind(this.planStorage);
  createPlanDays = this.planStorage.createPlanDays.bind(this.planStorage);
  updatePlanDay = this.planStorage.updatePlanDay.bind(this.planStorage);
  getPlanDay = this.planStorage.getPlanDay.bind(this.planStorage);
  deletePlanDay = this.planStorage.deletePlanDay.bind(this.planStorage);
  schedulePlan = this.planStorage.schedulePlan.bind(this.planStorage);
  markMissedPlanDays = this.planStorage.markMissedPlanDays.bind(this.planStorage);

  getTimeline = this.timelineStorage.getTimeline.bind(this.timelineStorage);

  getAllExerciseSetsWithDates = this.analyticsStorage.getAllExerciseSetsWithDates.bind(this.analyticsStorage);
  getMissedWorkoutsForDate = this.analyticsStorage.getMissedWorkoutsForDate.bind(this.analyticsStorage);
  getWeeklyStats = this.analyticsStorage.getWeeklyStats.bind(this.analyticsStorage);
}

export const storage = new DatabaseStorage();
