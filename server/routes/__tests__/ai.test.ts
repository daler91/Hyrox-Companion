import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import aiRouter from "../ai";
import { storage } from "../../storage";
import { parseExercisesFromText, chatWithCoach, streamChatWithCoach, generateWorkoutSuggestions } from "../../gemini";
import { buildTrainingContext } from "../../services/aiService";
import { retrieveRelevantChunks } from "../../services/ragService";

const MOCK_TRAINING_CONTEXT = "Training context";
const CHAT_STREAM_ENDPOINT = "/api/v1/chat/stream";
const CHAT_ENDPOINT = "/api/v1/chat";

function parseStreamResponse(responseText: string) {
  return responseText.split("\n\n").filter(Boolean);
}


// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

// Mock the getUserId function to return our test user
vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
  toDateStr: () => "2024-03-10",
}));

// Mock the storage functions
vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    getCustomExercises: vi.fn(),
    getChatMessages: vi.fn(),
    saveChatMessage: vi.fn(),
    clearChatHistory: vi.fn(),
    getTimeline: vi.fn(),
    listCoachingMaterials: vi.fn(),
    hasChunksForUser: vi.fn().mockResolvedValue(false),
  },
}));

// Mock the gemini functions
vi.mock("../../gemini", () => ({
  parseExercisesFromText: vi.fn(),
  chatWithCoach: vi.fn(),
  streamChatWithCoach: vi.fn(),
  generateWorkoutSuggestions: vi.fn(),
}));

// Mock aiService
vi.mock("../../services/aiService", () => ({
  buildTrainingContext: vi.fn(),
}));

vi.mock("../../services/ragService", () => ({
  retrieveRelevantChunks: vi.fn(),
}));

// Mock prompts
vi.mock("../../prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../prompts")>();
  return {
    ...actual,
    buildCoachingMaterialsSection: vi.fn().mockReturnValue(""),
  };
});

describe("POST /api/parse-exercises", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1));
    app = express();
    app.use(express.json());
    app.use(aiRouter);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should successfully parse exercises and return them", async () => {

    vi.mocked(storage.getUser).mockResolvedValue({ weightUnit: "lbs" });
    vi.mocked(storage.getCustomExercises).mockResolvedValue([{ name: "Custom Squat" }]);

    const mockParsedExercises = [
      { name: "Bench Press", sets: [{ weight: 135, reps: 10 }] }
    ];
    vi.mocked(parseExercisesFromText).mockResolvedValue(mockParsedExercises);

    const response = await request(app)
      .post("/api/v1/parse-exercises")
      .send({ text: "Bench press 135x10" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockParsedExercises);
    expect(storage.getUser).toHaveBeenCalledWith("test_user_id");
    expect(storage.getCustomExercises).toHaveBeenCalledWith("test_user_id");
    expect(parseExercisesFromText).toHaveBeenCalledWith("Bench press 135x10", "lbs", ["Custom Squat"]);
  });

  it("should return 400 if text is missing", async () => {
    const response = await request(app)
      .post("/api/v1/parse-exercises")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("error", "Text is required");
  });


  it("should return 500 when AI parsing fails", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({ weightUnit: "lbs" });
    vi.mocked(storage.getCustomExercises).mockResolvedValue([]);
    vi.mocked(parseExercisesFromText).mockRejectedValue(new Error("AI error"));

    const response = await request(app)
      .post("/api/v1/parse-exercises")
      .send({ text: "Bench press 135x10" });

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to parse exercises");
  });


  it("should return 500 when AI coach response fails", async () => {
    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    vi.mocked(chatWithCoach).mockRejectedValue(new Error("AI error"));

    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ message: "Hello", history: [] });

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to get response from AI coach");
  });

  it("should return 500 on internal error", async () => {
    vi.mocked(storage.getUser).mockRejectedValue(new Error("Database error"));

    const response = await request(app)
      .post("/api/v1/parse-exercises")
      .send({ text: "Bench press 135x10" });

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to parse exercises");
  });

  it("should rate limit requests after 5 attempts", async () => {

    vi.mocked(storage.getUser).mockResolvedValue({ weightUnit: "kg" });
    vi.mocked(storage.getCustomExercises).mockResolvedValue([]);
    vi.mocked(parseExercisesFromText).mockResolvedValue([]);

    const payload = { text: "Squat 100x5" };

    // First 5 requests should succeed
    for (let i = 0; i < 5; i++) {
      const response = await request(app).post("/api/v1/parse-exercises").send(payload);
      expect(response.status).toBe(200);
    }

    // 6th request should fail
    const rateLimitedResponse = await request(app).post("/api/v1/parse-exercises").send(payload);
    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.body.error).toContain("Too many requests");

    // Advance time beyond the 60 second window
    vi.advanceTimersByTime(61000);

    // Next request should succeed again
    const successfulResponse = await request(app).post("/api/v1/parse-exercises").send(payload);
    expect(successfulResponse.status).toBe(200);
  });
});

describe("POST /api/chat", () => {
  let app: express.Express;




  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    app = express();
    app.use(express.json());
    app.use(aiRouter);
  });

  it("should successfully chat with coach and return response", async () => {

    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    vi.mocked(chatWithCoach).mockResolvedValue("Coach response");

    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ message: "Hello", history: [] });

    expect(response.status).toBe(200);
    expect(response.body.response).toBe("Coach response");
    expect(response.body.ragInfo).toBeDefined();
    expect(buildTrainingContext).toHaveBeenCalledWith("test_user_id");
    expect(chatWithCoach).toHaveBeenCalledWith("Hello", [], MOCK_TRAINING_CONTEXT, [], undefined);
  });

  it("should return 400 if message is missing", async () => {
    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ history: [] });

    expect(response.status).toBe(400);
  });

  it("should return 500 on internal error", async () => {
    vi.mocked(buildTrainingContext).mockRejectedValue(new Error("Database error"));

    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ message: "Hello", history: [] });

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to get response from AI coach");
  });
});

describe("POST /api/chat/stream", () => {
  let app: express.Express;





  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    app = express();
    app.use(express.json());
    app.use(aiRouter);
  });

  it("should successfully stream chat response", async () => {

    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);

    vi.mocked(streamChatWithCoach).mockImplementation(async function* () {
      yield "Hello";
      yield " World";
    });

    const response = await request(app)
      .post(CHAT_STREAM_ENDPOINT)
      .send({ message: "Hello stream", history: [] });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");

    // Test the event stream format (first chunk is ragInfo meta event)
    const chunks = parseStreamResponse(response.text);
    expect(chunks[0]).toContain('"ragInfo"');
    expect(chunks[1]).toContain('{"text":"Hello"}');
    expect(chunks[2]).toContain('{"text":" World"}');
    expect(chunks[3]).toContain('{"done":true}');

    expect(buildTrainingContext).toHaveBeenCalledWith("test_user_id");
    expect(streamChatWithCoach).toHaveBeenCalledWith("Hello stream", [], MOCK_TRAINING_CONTEXT, [], undefined);
  });

  it("should handle stream errors gracefully", async () => {

    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);

    vi.mocked(streamChatWithCoach).mockImplementation(() => ({
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(new Error("Stream failure"));
          }
        };
      }
    }));

    const response = await request(app)
      .post(CHAT_STREAM_ENDPOINT)
      .send({ message: "Error", history: [] });

    expect(response.status).toBe(200);
    const chunks = parseStreamResponse(response.text);
    expect(chunks[0]).toContain('"ragInfo"');
    expect(chunks[1]).toContain('{"error":"Stream error"}');
  });
});


const CHAT_HISTORY_ENDPOINT = "/api/v1/chat/history";
const CHAT_MESSAGE_ENDPOINT = "/api/v1/chat/message";
describe("Chat History and Messages Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    app = express();
    app.use(express.json());
    app.use(aiRouter);
  });

  it("should get chat history", async () => {

    const mockMessages = [{ id: 1, role: "user", content: "Hi" }];
    vi.mocked(storage.getChatMessages).mockResolvedValue(mockMessages);

    const response = await request(app).get(CHAT_HISTORY_ENDPOINT);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockMessages);
    expect(storage.getChatMessages).toHaveBeenCalledWith("test_user_id");
  });

  it("should return 500 when getting history fails", async () => {

    vi.mocked(storage.getChatMessages).mockRejectedValue(new Error("Database Error"));

    const response = await request(app).get(CHAT_HISTORY_ENDPOINT);

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to get chat history");
  });

  it("should save chat message", async () => {

    const savedMessage = { id: 1, userId: "test_user_id", role: "user", content: "Hello" };
    vi.mocked(storage.saveChatMessage).mockResolvedValue(savedMessage);

    const response = await request(app)
      .post(CHAT_MESSAGE_ENDPOINT)
      .send({ role: "user", content: "Hello", userId: "test_user_id" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(savedMessage);
    expect(storage.saveChatMessage).toHaveBeenCalledWith({
      userId: "test_user_id",
      role: "user",
      content: "Hello",
    });
  });

  it("should return 400 when missing role or content", async () => {
    const response = await request(app)
      .post(CHAT_MESSAGE_ENDPOINT)
      .send({ role: "user" });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("error", "Role and content are required");
  });

  it("should clear chat history", async () => {

    vi.mocked(storage.clearChatHistory).mockResolvedValue(undefined);

    const response = await request(app).delete(CHAT_HISTORY_ENDPOINT);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(storage.clearChatHistory).toHaveBeenCalledWith("test_user_id");
  });

  it("should return 500 when clearing history fails", async () => {

    vi.mocked(storage.clearChatHistory).mockRejectedValue(new Error("Delete failed"));

    const response = await request(app).delete(CHAT_HISTORY_ENDPOINT);

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to clear chat history");
  });
});

const TIMELINE_SUGGESTIONS_ENDPOINT = "/api/v1/timeline/ai-suggestions";
describe("POST /api/timeline/ai-suggestions", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    app = express();
    app.use(express.json());
    app.use(aiRouter);
  });

  it("should successfully generate suggestions", async () => {

    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);

    const mockTimeline = [
      {
        status: "planned",
        date: "2024-03-12",
        planDayId: 1,
        focus: "Legs",
        mainWorkout: "Squats",
        accessory: "Lunges",
      },
      {
        status: "planned",
        date: "2024-03-09", // Past date, should be filtered out
        planDayId: 2,
        focus: "Chest",
        mainWorkout: "Bench",
      },
      {
        status: "completed", // Completed, should be filtered out
        date: "2024-03-13",
        planDayId: 3,
        focus: "Back",
        mainWorkout: "Pullups",
      },
    ];
    vi.mocked(storage.getTimeline).mockResolvedValue(mockTimeline);

    const rawSuggestions = [
      {
        workoutId: 1,
        targetField: "notes",
        action: "append",
        recommendation: "Increase volume",
        rationale: "Because",
        priority: "high",
      },
    ];
    vi.mocked(generateWorkoutSuggestions).mockResolvedValue(rawSuggestions);

    const response = await request(app).post(TIMELINE_SUGGESTIONS_ENDPOINT);

    expect(response.status).toBe(200);
    expect(response.body.suggestions).toHaveLength(1);
    expect(response.body.suggestions[0]).toEqual({
      workoutId: 1,
      date: "2024-03-12",
      focus: "Legs",
      targetField: "notes",
      action: "append",
      recommendation: "Increase volume",
      rationale: "Because",
      priority: "high",
    });

    // Check that it filtered only future planned workouts
    const expectedUpcomingWorkouts = [
      {
        id: 1,
        date: "2024-03-12",
        focus: "Legs",
        mainWorkout: "Squats",
        accessory: "Lunges",
        notes: undefined,
      },
    ];
    expect(generateWorkoutSuggestions).toHaveBeenCalledWith(
      "Training context",
      expectedUpcomingWorkouts,
      undefined,
      undefined,
    );
  });

  it("should handle no upcoming planned workouts gracefully", async () => {

    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    // No planned, future workouts
    vi.mocked(storage.getTimeline).mockResolvedValue([
      {
        status: "completed",
        date: "2024-03-12",
        planDayId: 1,
        focus: "Legs",
      },
    ]);

    const response = await request(app).post(TIMELINE_SUGGESTIONS_ENDPOINT);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      suggestions: [],
      message: "No upcoming planned workouts found",
    });
  });


  it("should return 500 when AI suggestions generation fails", async () => {
    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    vi.mocked(storage.getTimeline).mockResolvedValue([
      {
        status: "planned",
        date: "2024-03-12",
        planDayId: 1,
        focus: "Legs",
        mainWorkout: "Squats",
      }
    ]);
    vi.mocked(generateWorkoutSuggestions).mockRejectedValue(new Error("AI Workout generation error"));

    const response = await request(app).post(TIMELINE_SUGGESTIONS_ENDPOINT);

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to generate AI suggestions");
  });

  it("should return 500 on error", async () => {

    vi.mocked(storage.getTimeline).mockRejectedValue(new Error("DB Error"));

    const response = await request(app).post(TIMELINE_SUGGESTIONS_ENDPOINT);

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to generate AI suggestions");
  });
});

// ---------------------------------------------------------------------------
// RAG pipeline integration tests
// ---------------------------------------------------------------------------

describe("RAG pipeline in chat endpoints", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    app = express();
    app.use(express.json());
    app.use(aiRouter);
  });

  it("should use RAG retrieval when user has embedded chunks", async () => {
    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    vi.mocked(chatWithCoach).mockResolvedValue("RAG response");
    vi.mocked(storage.hasChunksForUser).mockResolvedValue(true);
    vi.mocked(retrieveRelevantChunks).mockResolvedValue(["chunk about squats", "chunk about programming"]);

    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ message: "How should I train squats?", history: [] });

    expect(response.status).toBe(200);
    expect(storage.hasChunksForUser).toHaveBeenCalledWith("test_user_id");
    expect(retrieveRelevantChunks).toHaveBeenCalledWith("test_user_id", "How should I train squats?");
    // Should pass retrievedChunks instead of coachingMaterials
    expect(chatWithCoach).toHaveBeenCalledWith(
      "How should I train squats?",
      [],
      MOCK_TRAINING_CONTEXT,
      undefined,
      ["chunk about squats", "chunk about programming"],
    );
    // Should NOT fall back to legacy materials
    expect(storage.listCoachingMaterials).not.toHaveBeenCalled();
  });

  it("should fall back to legacy materials when no chunks exist", async () => {
    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    vi.mocked(chatWithCoach).mockResolvedValue("Legacy response");
    vi.mocked(storage.hasChunksForUser).mockResolvedValue(false);
    vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);

    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ message: "Hello", history: [] });

    expect(response.status).toBe(200);
    expect(storage.hasChunksForUser).toHaveBeenCalledWith("test_user_id");
    expect(retrieveRelevantChunks).not.toHaveBeenCalled();
    expect(storage.listCoachingMaterials).toHaveBeenCalledWith("test_user_id");
  });

  it("should fall back to legacy materials when RAG retrieval returns empty", async () => {
    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    vi.mocked(chatWithCoach).mockResolvedValue("Fallback response");
    vi.mocked(storage.hasChunksForUser).mockResolvedValue(true);
    vi.mocked(retrieveRelevantChunks).mockResolvedValue([]);
    vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);

    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ message: "Hello", history: [] });

    expect(response.status).toBe(200);
    // Empty retrieval should trigger fallback
    expect(storage.listCoachingMaterials).toHaveBeenCalledWith("test_user_id");
  });

  it("should fall back to legacy materials when RAG retrieval throws", async () => {
    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    vi.mocked(chatWithCoach).mockResolvedValue("Error fallback");
    vi.mocked(storage.hasChunksForUser).mockRejectedValue(new Error("DB error"));
    vi.mocked(storage.listCoachingMaterials).mockResolvedValue([]);

    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ message: "Hello", history: [] });

    expect(response.status).toBe(200);
    // Should gracefully fall back
    expect(storage.listCoachingMaterials).toHaveBeenCalledWith("test_user_id");
  });

  it("should use RAG retrieval for streaming endpoint", async () => {
    vi.mocked(buildTrainingContext).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    vi.mocked(storage.hasChunksForUser).mockResolvedValue(true);
    vi.mocked(retrieveRelevantChunks).mockResolvedValue(["relevant chunk"]);
    vi.mocked(streamChatWithCoach).mockImplementation(async function* () {
      yield "Streamed";
    });

    const response = await request(app)
      .post(CHAT_STREAM_ENDPOINT)
      .send({ message: "Train me", history: [] });

    expect(response.status).toBe(200);
    expect(streamChatWithCoach).toHaveBeenCalledWith(
      "Train me",
      [],
      MOCK_TRAINING_CONTEXT,
      undefined,
      ["relevant chunk"],
    );
  });
});
