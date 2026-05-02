import type { Job } from "pg-boss";
import { describe, expect, it } from "vitest";

import { getEmbedJobIdentifiers, getJobData, getUserIdFromJob, hasIdentifier } from "./queue.utils";

describe("queue utils", () => {
  it("returns typed job payload", () => {
    const job = { data: { userId: "u1" } } as Job;
    const payload = getJobData<{ userId: string }>(job);
    expect(payload.userId).toBe("u1");
  });

  it("accepts non-empty string identifiers", () => {
    expect(hasIdentifier("abc")).toBe(true);
    expect(hasIdentifier("")).toBe(false);
    expect(hasIdentifier(undefined)).toBe(false);
  });

  it("normalizes userId payloads", () => {
    expect(getUserIdFromJob({ data: { userId: "u1" } } as Job)).toBe("u1");
    expect(getUserIdFromJob({ data: { userId: "" } } as Job)).toBeNull();
  });

  it("normalizes embed-coaching-material identifiers", () => {
    expect(getEmbedJobIdentifiers({ data: { materialId: "m1", userId: "u1" } } as Job)).toEqual({
      materialId: "m1",
      userId: "u1",
    });
    expect(getEmbedJobIdentifiers({ data: { materialId: "m1" } } as Job)).toBeNull();
  });
});
