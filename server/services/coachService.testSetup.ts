import { afterEach, beforeEach, vi } from "vitest";

import { lockAutoCoachWriteTargets } from "./autoCoachWriteGuard";
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
// The text provider counts as configured unless a test says otherwise (the
// configuration-error path in coachService.autoCoach.modelFailure.test.ts).
vi.mock("../ai/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/providers")>()),
  isTextAiProviderConfigured: vi.fn(() => true),
}));
// The write-time lock and staleness check (AI16) has its own SQL-level tests
// in autoCoachWriteGuard.test.ts; here every snapshot is still current unless
// a test says otherwise.
vi.mock("./autoCoachWriteGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./autoCoachWriteGuard")>()),
  lockAutoCoachWriteTargets: vi.fn(),
}));
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
  vi.mocked(lockAutoCoachWriteTargets).mockResolvedValue({ dayIds: new Set(), adaptation: false });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});
