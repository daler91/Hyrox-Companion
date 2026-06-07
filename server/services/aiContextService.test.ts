import type { RagInfo } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainingContext } from "../gemini/index";
import { logger } from "../logger";
import { buildCoachingMaterialsSection, buildRetrievedChunksSection } from "../prompts";
import { buildTrainingContext } from "./ai";
import { type AIContext, buildAIContext, extractCoachingMaterialsText } from "./aiContextService";
import { retrieveCoachingContext } from "./ragRetrieval";

vi.mock("./ai", () => ({ buildTrainingContext: vi.fn() }));
vi.mock("./ragRetrieval", () => ({ retrieveCoachingContext: vi.fn() }));
vi.mock("../prompts", () => ({
  buildRetrievedChunksSection: vi.fn(),
  buildCoachingMaterialsSection: vi.fn(),
}));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const trainingMock = vi.mocked(buildTrainingContext);
const retrieveMock = vi.mocked(retrieveCoachingContext);
const chunksSectionMock = vi.mocked(buildRetrievedChunksSection);
const materialsSectionMock = vi.mocked(buildCoachingMaterialsSection);

const TRAINING_CONTEXT = { totalWorkouts: 5 } as unknown as TrainingContext;
const RAG_INFO = { usedRag: true } as unknown as RagInfo;

function ctx(overrides: Partial<AIContext> = {}): AIContext {
  return {
    trainingContext: TRAINING_CONTEXT,
    ragInfo: RAG_INFO,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  trainingMock.mockResolvedValue(TRAINING_CONTEXT);
  retrieveMock.mockResolvedValue({ ragInfo: RAG_INFO });
  chunksSectionMock.mockReturnValue("CHUNKS");
  materialsSectionMock.mockReturnValue("MATERIALS");
});

describe("buildAIContext", () => {
  it("merges the training context with the coaching context", async () => {
    retrieveMock.mockResolvedValue({
      ragInfo: RAG_INFO,
      retrievedChunks: ["chunk-1"],
      coachingMaterials: [{ source: "doc" }] as never,
    });

    const result = await buildAIContext("user-1", "how is my squat");

    expect(result).toEqual({
      trainingContext: TRAINING_CONTEXT,
      ragInfo: RAG_INFO,
      retrievedChunks: ["chunk-1"],
      coachingMaterials: [{ source: "doc" }],
    });
  });

  it("queries both sources and defaults to the root logger", async () => {
    await buildAIContext("user-1", "my query");

    expect(trainingMock).toHaveBeenCalledWith("user-1");
    expect(retrieveMock).toHaveBeenCalledWith("user-1", "my query", logger);
  });

  it("threads a custom logger through to RAG retrieval", async () => {
    const customLog = { warn: vi.fn(), error: vi.fn() };
    await buildAIContext("user-1", "my query", customLog);
    expect(retrieveMock).toHaveBeenCalledWith("user-1", "my query", customLog);
  });

  it("rejects when the training-context build fails", async () => {
    trainingMock.mockRejectedValue(new Error("training down"));
    await expect(buildAIContext("user-1", "q")).rejects.toThrow("training down");
  });

  it("rejects when coaching-context retrieval fails", async () => {
    retrieveMock.mockRejectedValue(new Error("rag down"));
    await expect(buildAIContext("user-1", "q")).rejects.toThrow("rag down");
  });
});

describe("extractCoachingMaterialsText", () => {
  it("returns the retrieved-chunks section when chunks are present", () => {
    const result = extractCoachingMaterialsText(ctx({ retrievedChunks: ["a", "b"] }));
    expect(result).toBe("CHUNKS");
    expect(chunksSectionMock).toHaveBeenCalledWith(["a", "b"]);
  });

  it("prefers retrieved chunks over coaching materials", () => {
    extractCoachingMaterialsText(
      ctx({ retrievedChunks: ["a"], coachingMaterials: [{ source: "doc" }] as never }),
    );
    expect(chunksSectionMock).toHaveBeenCalledTimes(1);
    expect(materialsSectionMock).not.toHaveBeenCalled();
  });

  it("falls back to coaching materials when the chunks array is empty", () => {
    const materials = [{ source: "doc" }] as never;
    const result = extractCoachingMaterialsText(
      ctx({ retrievedChunks: [], coachingMaterials: materials }),
    );
    expect(result).toBe("MATERIALS");
    expect(chunksSectionMock).not.toHaveBeenCalled();
    expect(materialsSectionMock).toHaveBeenCalledWith(materials);
  });

  it("uses coaching materials when chunks are absent", () => {
    const result = extractCoachingMaterialsText(
      ctx({ coachingMaterials: [{ source: "doc" }] as never }),
    );
    expect(result).toBe("MATERIALS");
  });

  it("returns undefined when the coaching materials render to an empty string", () => {
    materialsSectionMock.mockReturnValue("");
    const result = extractCoachingMaterialsText(
      ctx({ coachingMaterials: [{ source: "doc" }] as never }),
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when neither chunks nor materials are present", () => {
    const result = extractCoachingMaterialsText(ctx());
    expect(result).toBeUndefined();
  });
});
