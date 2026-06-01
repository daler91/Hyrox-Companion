import { describe, expect, it } from "vitest";

import type { ParseWorkoutStructureResponse } from "@/lib/api";

import {
  buildParseImagePayload,
  type ImagePreviewState,
  shouldRetainImagePreview,
} from "../workoutComposer.utils";

describe("workoutComposer.utils", () => {
  describe("buildParseImagePayload", () => {
    it("should correctly map base64 and mimeType to payload", () => {
      const preview: ImagePreviewState = {
        url: "blob:http://localhost/123",
        base64: "dGVzdA==",
        mimeType: "image/jpeg",
      };

      const payload = buildParseImagePayload(preview);

      expect(payload).toEqual({
        imageBase64: "dGVzdA==",
        mimeType: "image/jpeg",
      });
    });
  });

  describe("shouldRetainImagePreview", () => {
    it("should return true when parsed is null", () => {
      expect(shouldRetainImagePreview(null)).toBe(true);
    });

    it("should return true when parsed is undefined", () => {
      expect(shouldRetainImagePreview(undefined)).toBe(true);
    });

    it("should return true when parsed has no exercises and no structure blocks", () => {
      const parsed = {
        exercises: [],
        structureBlocks: [],
        warnings: [],
      } as unknown as ParseWorkoutStructureResponse;
      expect(shouldRetainImagePreview(parsed)).toBe(true);
    });

    it("should return false when parsed has exercises but no structure blocks", () => {
      const parsed = {
        exercises: [{ exerciseName: "Squat", sets: [] }],
        structureBlocks: [],
        warnings: [],
      } as unknown as ParseWorkoutStructureResponse;
      expect(shouldRetainImagePreview(parsed)).toBe(false);
    });

    it("should return false when parsed has structure blocks but no exercises", () => {
      const parsed = {
        exercises: [],
        structureBlocks: [{ type: "warmup" }],
        warnings: [],
      } as unknown as ParseWorkoutStructureResponse;
      expect(shouldRetainImagePreview(parsed)).toBe(false);
    });

    it("should return false when parsed has both exercises and structure blocks", () => {
      const parsed = {
        exercises: [{ exerciseName: "Squat", sets: [] }],
        structureBlocks: [{ type: "warmup" }],
        warnings: [],
      } as unknown as ParseWorkoutStructureResponse;
      expect(shouldRetainImagePreview(parsed)).toBe(false);
    });
  });
});
