import { describe, expect, it } from "vitest";

import { isChatSendPath, isImageParsePath } from "./imageParsePaths";

describe("isImageParsePath", () => {
  it("allows stateless image parse routes to use the large JSON body parser", () => {
    expect(isImageParsePath("/api/v1/parse-exercises-from-image")).toBe(true);
    expect(isImageParsePath("/api/v1/parse-workout-structure-from-image")).toBe(true);
  });

  it("allows stateful workout and plan-day image reparse routes", () => {
    expect(isImageParsePath("/api/v1/workouts/workout-1/reparse-from-image")).toBe(true);
    expect(isImageParsePath("/api/v1/plans/days/day-1/reparse-from-image")).toBe(true);
  });

  it("allows the nutrition meal-photo and label parse routes", () => {
    expect(isImageParsePath("/api/v1/nutrition/parse/photo")).toBe(true);
    expect(isImageParsePath("/api/v1/nutrition/parse/label")).toBe(true);
  });

  it("leaves non-image routes on the default parser", () => {
    expect(isImageParsePath("/api/v1/parse-workout-structure")).toBe(false);
    expect(isImageParsePath("/api/v1/workouts/workout-1")).toBe(false);
    // The text meal-parse route uses the default (small) JSON body parser.
    expect(isImageParsePath("/api/v1/nutrition/parse/text")).toBe(false);
  });
});

describe("isChatSendPath", () => {
  it("gives the two chat send routes the photo-sized parser", () => {
    expect(isChatSendPath("/api/v1/chat")).toBe(true);
    expect(isChatSendPath("/api/v1/chat/stream")).toBe(true);
    expect(isChatSendPath("/api/v1/chat/stream/")).toBe(true);
  });

  it("leaves the other chat routes on the default parser", () => {
    expect(isChatSendPath("/api/v1/chat/message")).toBe(false);
    expect(isChatSendPath("/api/v1/chat/history")).toBe(false);
    expect(isChatSendPath("/api/v1/chat/messages/m-1/fact")).toBe(false);
    expect(isChatSendPath("/api/v1/chatter")).toBe(false);
  });
});
