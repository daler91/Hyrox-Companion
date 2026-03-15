import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import aiRouter from "../ai";
import { storage } from "../../storage";
import { parseExercisesFromText, chatWithCoach, streamChatWithCoach, generateWorkoutSuggestions } from "../../gemini";
import { buildTrainingContext } from "../../services/aiService";

const MOCK_TRAINING_CONTEXT = "Training context";
const CHAT_STREAM_ENDPOINT = "/api/chat/stream";
const CHAT_ENDPOINT = "/api/chat";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: any, res: any, next: any) => {
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

    (storage.getUser as any).mockResolvedValue({ weightUnit: "lbs" });
    (storage.getCustomExercises as any).mockResolvedValue([{ name: "Custom Squat" }]);

    const mockParsedExercises = [
      { name: "Bench Press", sets: [{ weight: 135, reps: 10 }] }
    ];
    (parseExercisesFromText as any).mockResolvedValue(mockParsedExercises);

    const response = await request(app)
      .post("/api/parse-exercises")
      .send({ text: "Bench press 135x10" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockParsedExercises);
    expect(storage.getUser).toHaveBeenCalledWith("test_user_id");
    expect(storage.getCustomExercises).toHaveBeenCalledWith("test_user_id");
    expect(parseExercisesFromText).toHaveBeenCalledWith("Bench press 135x10", "lbs", ["Custom Squat"]);
  });

  it("should return 400 if text is missing", async () => {
    const response = await request(app)
      .post("/api/parse-exercises")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("error", "Text is required");
  });

  it("should return 500 on internal error", async () => {
    (storage.getUser as any).mockRejectedValue(new Error("Database error"));

    const response = await request(app)
      .post("/api/parse-exercises")
      .send({ text: "Bench press 135x10" });

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to parse exercises");
  });

  it("should rate limit requests after 5 attempts", async () => {

    (storage.getUser as any).mockResolvedValue({ weightUnit: "kg" });
    (storage.getCustomExercises as any).mockResolvedValue([]);
    (parseExercisesFromText as any).mockResolvedValue([]);

    const payload = { text: "Squat 100x5" };

    // First 5 requests should succeed
    for (let i = 0; i < 5; i++) {
      const response = await request(app).post("/api/parse-exercises").send(payload);
      expect(response.status).toBe(200);
    }

    // 6th request should fail
    const rateLimitedResponse = await request(app).post("/api/parse-exercises").send(payload);
    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.body.error).toContain("Too many requests");

    // Advance time beyond the 60 second window
    vi.advanceTimersByTime(61000);

    // Next request should succeed again
    const successfulResponse = await request(app).post("/api/parse-exercises").send(payload);
    expect(successfulResponse.status).toBe(200);
  });
});

describe("POST /api/chat", () => {
  let app: express.Express;




  beforeEach(async () => {
    vi.clearAllMocks();
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    app = express();
    app.use(express.json());
    app.use(aiRouter);
  });

  it("should successfully chat with coach and return response", async () => {

    (buildTrainingContext as any).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    (chatWithCoach as any).mockResolvedValue("Coach response");

    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ message: "Hello", history: [] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ response: "Coach response" });
    expect(buildTrainingContext).toHaveBeenCalledWith("test_user_id");
    expect(chatWithCoach).toHaveBeenCalledWith("Hello", [], MOCK_TRAINING_CONTEXT);
  });

  it("should return 400 if message is missing", async () => {
    const response = await request(app)
      .post(CHAT_ENDPOINT)
      .send({ history: [] });

    expect(response.status).toBe(400);
  });

  it("should return 500 on internal error", async () => {
    (buildTrainingContext as any).mockRejectedValue(new Error("Database error"));

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
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    app = express();
    app.use(express.json());
    app.use(aiRouter);
  });

  it("should successfully stream chat response", async () => {

    (buildTrainingContext as any).mockResolvedValue(MOCK_TRAINING_CONTEXT);

    (streamChatWithCoach as any).mockImplementation(async function* () {
      yield "Hello";
      yield " World";
    });

    const response = await request(app)
      .post(CHAT_STREAM_ENDPOINT)
      .send({ message: "Hello stream", history: [] });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");

    // Test the event stream format
    const textChunks = response.text.split("\n\n").filter(Boolean);
    expect(textChunks[0]).toContain('{"text":"Hello"}');
    expect(textChunks[1]).toContain('{"text":" World"}');
    expect(textChunks[2]).toContain('{"done":true}');

    expect(buildTrainingContext).toHaveBeenCalledWith("test_user_id");
    expect(streamChatWithCoach).toHaveBeenCalledWith("Hello stream", [], MOCK_TRAINING_CONTEXT);
  });

  it("should handle stream errors gracefully", async () => {

    (buildTrainingContext as any).mockResolvedValue(MOCK_TRAINING_CONTEXT);

    (streamChatWithCoach as any).mockImplementation(async function* () {
      throw new Error("Stream failure");
    });

    const response = await request(app)
      .post(CHAT_STREAM_ENDPOINT)
      .send({ message: "Error", history: [] });

    expect(response.status).toBe(200);
    const textChunks = response.text.split("\n\n").filter(Boolean);
    expect(textChunks[0]).toContain('{"error":"Stream error"}');
  });
});

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
    (storage.getChatMessages as any).mockResolvedValue(mockMessages);

    const response = await request(app).get("/api/chat/history");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockMessages);
    expect(storage.getChatMessages).toHaveBeenCalledWith("test_user_id");
  });

  it("should return 500 when getting history fails", async () => {

    (storage.getChatMessages as any).mockRejectedValue(new Error("Database Error"));

    const response = await request(app).get("/api/chat/history");

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to get chat history");
  });

  it("should save chat message", async () => {

    const savedMessage = { id: 1, userId: "test_user_id", role: "user", content: "Hello" };
    (storage.saveChatMessage as any).mockResolvedValue(savedMessage);

    const response = await request(app)
      .post("/api/chat/message")
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
      .post("/api/chat/message")
      .send({ role: "user" });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("error", "Role and content are required");
  });

  it("should clear chat history", async () => {

    (storage.clearChatHistory as any).mockResolvedValue(undefined);

    const response = await request(app).delete("/api/chat/history");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(storage.clearChatHistory).toHaveBeenCalledWith("test_user_id");
  });

  it("should return 500 when clearing history fails", async () => {

    (storage.clearChatHistory as any).mockRejectedValue(new Error("Delete failed"));

    const response = await request(app).delete("/api/chat/history");

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to clear chat history");
  });
});

describe("POST /api/timeline/ai-suggestions", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    app = express();
    app.use(express.json());
    app.use(aiRouter);
  });

  it("should successfully generate suggestions", async () => {

    (buildTrainingContext as any).mockResolvedValue(MOCK_TRAINING_CONTEXT);

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
    (storage.getTimeline as any).mockResolvedValue(mockTimeline);

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
    (generateWorkoutSuggestions as any).mockResolvedValue(rawSuggestions);

    const response = await request(app).post("/api/timeline/ai-suggestions");

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
      },
    ];
    expect(generateWorkoutSuggestions).toHaveBeenCalledWith(
      "Training context",
      expectedUpcomingWorkouts
    );
  });

  it("should handle no upcoming planned workouts gracefully", async () => {

    (buildTrainingContext as any).mockResolvedValue(MOCK_TRAINING_CONTEXT);
    // No planned, future workouts
    (storage.getTimeline as any).mockResolvedValue([
      {
        status: "completed",
        date: "2024-03-12",
        planDayId: 1,
        focus: "Legs",
      },
    ]);

    const response = await request(app).post("/api/timeline/ai-suggestions");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      suggestions: [],
      message: "No upcoming planned workouts found",
    });
  });

  it("should return 500 on error", async () => {

    (storage.getTimeline as any).mockRejectedValue(new Error("DB Error"));

    const response = await request(app).post("/api/timeline/ai-suggestions");

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error", "Failed to generate AI suggestions");
  });
});
