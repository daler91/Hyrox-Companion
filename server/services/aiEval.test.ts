import { describe, it, expect, vi, beforeAll } from "vitest";
import { chatWithCoach } from "../gemini/chatService";
import { retrieveRelevantChunks } from "./ragService";
import { generateEmbedding } from "../gemini/client";
import { env } from "../env";
import { storage } from "../storage";

// These evaluation tests run against the real Gemini API to monitor AI regression.
// They are skipped by default in normal CI runs to avoid costs and flakiness,
// and should be triggered explicitly (e.g., via RUN_AI_EVAL=true).
const runEval = process.env.RUN_AI_EVAL === "true";

function calculateCosineSimilarity(embedding1: number[], embedding2: number[]): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}


describe.runIf(runEval)("AI Services Evaluation Harness", () => {
  beforeAll(() => {
    if (!env.GEMINI_API_KEY) {
      console.warn("GEMINI_API_KEY is not set. Eval tests may fail.");
    }
  });

  describe("chatWithCoach Output Determinism", () => {
    it("should provide consistent guidance for a known Hyrox query", async () => {
      const userMessage = "What is a good pacing strategy for the 1km runs in Hyrox?";

      const response = await chatWithCoach(userMessage, [], undefined, undefined, []);

      // We don't expect an exact string match, but we expect certain keywords or concepts
      // to be consistently present in a good response about Hyrox pacing.
      const lowerResponse = response.toLowerCase();
      expect(lowerResponse.length).toBeGreaterThan(100);

      // Core concepts that should remain stable across model iterations
      const expectedKeywords = ["pace", "run", "compromised", "heart rate", "zone"];
      const matchCount = expectedKeywords.filter(keyword => lowerResponse.includes(keyword)).length;

      // Expect at least some of the core concepts to be present
      expect(matchCount).toBeGreaterThanOrEqual(2);
    }, 15000); // Allow longer timeout for real API call

    it("should gracefully handle and acknowledge lack of training context", async () => {
      const userMessage = "How am I doing on my training plan?";

      // Empty context
      const response = await chatWithCoach(userMessage, [], undefined, undefined, []);

      const lowerResponse = response.toLowerCase();

      // The AI should recognize that it doesn't have the user's data
      const impliesNoData = lowerResponse.includes("don't have") ||
                            lowerResponse.includes("cannot see") ||
                            lowerResponse.includes("no information") ||
                            lowerResponse.includes("share more");

      expect(impliesNoData).toBe(true);
    }, 15000);
  });

  describe("System Prompt Context Integration", () => {
    it("should correctly incorporate complex training context into AI instructions", async () => {
      // Mock an extensive training context
      const mockContext = {
        totalWorkouts: 45,
        completedWorkouts: 40,
        plannedWorkouts: 5,
        missedWorkouts: 0,
        skippedWorkouts: 0,
        completionRate: 100,
        currentStreak: 12,
        weeklyGoal: 4,
        recentWorkouts: [
          {
            date: "2024-03-20",
            focus: "Hyrox Simulation",
            mainWorkout: "1km run, 100 wall balls, 1km run",
            status: "completed" as const,
          }
        ],
        exerciseBreakdown: { "running": 10, "wall balls": 5 },
        structuredExerciseStats: {
          "wall balls": { count: 5, maxWeight: 6, avgReps: 100 }
        },
        activePlan: { name: "Hyrox Pro", totalWeeks: 12, goal: "Sub 1:15" }
      };

      // Since we can't directly inspect the system prompt sent to Gemini from the outside easily,
      // we ask Gemini a question that forces it to use the system prompt context.
      const userMessage = "What was my max weight for wall balls according to my recent stats? And what is my current streak? Just state the numbers.";

      const response = await chatWithCoach(userMessage, [], mockContext, undefined, []);

      const lowerResponse = response.toLowerCase();

      // It should know the streak is 12
      expect(lowerResponse).toContain("12");
      // It should know the max weight for wall balls is 6
      expect(lowerResponse).toContain("6");
    }, 15000);
  });

  describe("RAG Embedding Determinism", () => {
    it("should maintain semantic similarity scores for known related concepts", async () => {
      // We generate embeddings for two concepts that should be highly related
      const embedding1 = await generateEmbedding("Hyrox wall balls technique and standards");
      const embedding2 = await generateEmbedding("How to perform wall balls efficiently in a race");

      const similarity = calculateCosineSimilarity(embedding1, embedding2);

      // These should be highly semantically similar (e.g., > 0.7)
      // If a new model version drops this significantly, it's a regression
      expect(similarity).toBeGreaterThan(0.7);
    }, 15000);

    it("should distinguish clearly between unrelated concepts", async () => {
      const embedding1 = await generateEmbedding("Hyrox wall balls technique");
      const embedding2 = await generateEmbedding("How to bake a chocolate cake");

      const similarity = calculateCosineSimilarity(embedding1, embedding2);

      // These should have low semantic similarity
      expect(similarity).toBeLessThan(0.4);
    }, 15000);
  });

  describe("RAG Chunk Retrieval", () => {
    it("should correctly identify the most relevant chunks from a mock DB setup", async () => {
      // 1. Generate real embeddings
      const targetChunk = "When running the 1km intervals in Hyrox, try to maintain zone 3 heart rate.";

      const targetEmbedding = await generateEmbedding(targetChunk);

      // 2. Mock storage to return chunks as if it was returning from DB
      const mockSearchChunks = vi.spyOn(storage, "searchChunksByEmbedding").mockImplementation(async (userId, queryEmbedding, topK) => {
        // In real execution, pgvector handles the cosine distance sorting. But here we just mock
        // the returned data to verify that retrieveRelevantChunks returns the right strings.
        return [
          {
            id: "1",
            materialId: "m1",
            userId: "u1",
            content: targetChunk,
            chunkIndex: 0,
            embedding: JSON.stringify(targetEmbedding),
            createdAt: new Date()
          }
        ];
      });

      const results = await retrieveRelevantChunks("u1", "Hyrox 1km run heart rate");

      // 3. Verify
      expect(mockSearchChunks).toHaveBeenCalled();
      expect(results).toContain(targetChunk);

      mockSearchChunks.mockRestore();
    }, 15000);
  });
});
