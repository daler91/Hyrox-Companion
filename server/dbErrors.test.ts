import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { isUniqueViolation } from "./dbErrors";

/** What node-pg raises for a unique violation. */
function pgUniqueViolation(constraint: string): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
    constraint,
    severity: "ERROR",
  });
}

/** What callers actually see: drizzle wraps every driver error, pg error on `.cause`. */
function drizzleWrapped(cause: Error): DrizzleQueryError {
  return new DrizzleQueryError("insert into users ...", [], cause);
}

describe("isUniqueViolation", () => {
  it("matches a bare pg unique violation", () => {
    expect(isUniqueViolation(pgUniqueViolation("users_email_unique"))).toBe(true);
  });

  it("matches the violation through drizzle's DrizzleQueryError wrapper", () => {
    // The wrapper itself carries no `code`; reading only the top level (as the
    // users_email_unique checks once did) never matched a real violation.
    const wrapped = drizzleWrapped(pgUniqueViolation("users_email_unique"));
    expect((wrapped as { code?: unknown }).code).toBeUndefined();
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(wrapped, "users_email_unique")).toBe(true);
  });

  it("matches only the named constraint when one is given", () => {
    const wrapped = drizzleWrapped(pgUniqueViolation("uq_training_plans_user_in_flight"));
    expect(isUniqueViolation(wrapped, "uq_training_plans_user_in_flight")).toBe(true);
    expect(isUniqueViolation(wrapped, "users_email_unique")).toBe(false);
  });

  it("ignores other SQLSTATEs", () => {
    const fkViolation = Object.assign(new Error("fk"), { code: "23503", constraint: "users_email_unique" });
    expect(isUniqueViolation(drizzleWrapped(fkViolation))).toBe(false);
    expect(isUniqueViolation(drizzleWrapped(fkViolation), "users_email_unique")).toBe(false);
  });

  it("returns false for non-errors", () => {
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("stops at a cyclic cause chain instead of spinning", () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = { cause: a };
    a.cause = b;
    expect(isUniqueViolation(a)).toBe(false);
  });

  it("bounds the walk at five links", () => {
    let err: unknown = pgUniqueViolation("users_email_unique");
    for (let i = 0; i < 5; i++) err = { cause: err };
    expect(isUniqueViolation(err)).toBe(false);
  });
});
