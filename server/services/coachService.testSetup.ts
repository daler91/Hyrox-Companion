import { afterEach, beforeEach, vi } from "vitest";

import { dbMockState } from "./coachService.dbMockState";

vi.mock("../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
      updateIsAutoCoaching: vi.fn(),
    },
    workouts: {
      getExerciseSetsByPlanDay: vi.fn(),
    },
    plans: {
      listTrainingPlans: vi.fn(),
      getActivePlan: vi.fn(),
      getPlanDay: vi.fn(),
      updatePlanDay: vi.fn(),
    },
    timeline: {
      getTimeline: vi.fn(),
    },
    coaching: {
      hasChunksForUser: vi.fn(),
      getStoredEmbeddingDimension: vi.fn(),
      listCoachingMaterials: vi.fn(),
    },
    aiUsage: {
      getDailyTotalCents: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock("../db", () => ({
  db: {
    transaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn(dbMockState.tx as unknown)),
  },
}));

vi.mock("./ai", () => ({ buildTrainingContext: vi.fn() }));
vi.mock("../gemini/index", () => ({
  generateWorkoutSuggestions: vi.fn(),
  generateReviewNotes: vi.fn().mockResolvedValue([]),
  parseExercisesFromText: vi.fn(),
  EMBEDDING_DIMENSIONS: 3072,
}));
vi.mock("./ragService", () => ({ retrieveRelevantChunks: vi.fn() }));
vi.mock("../prompts", () => ({
  buildCoachingMaterialsSection: vi.fn().mockReturnValue(""),
  buildRetrievedChunksSection: vi.fn().mockReturnValue("[RAG chunks]"),
  FUNCTIONAL_EXERCISES: [
    "skierg",
    "sled_push",
    "sled_pull",
    "burpee_broad_jump",
    "rowing",
    "farmers_carry",
    "sandbag_lunges",
    "wall_balls",
  ],
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  dbMockState.deleteWhere.mockResolvedValue(undefined);
  dbMockState.insertValues.mockResolvedValue(undefined);
  dbMockState.selectWhere.mockResolvedValue([{ maxSortOrder: 1 }]);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});
