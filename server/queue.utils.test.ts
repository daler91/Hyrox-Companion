import type { Job } from "pg-boss";
import { describe, expect, it } from "vitest";

import { getJobData, hasIdentifier } from "./queue.utils";

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
});
