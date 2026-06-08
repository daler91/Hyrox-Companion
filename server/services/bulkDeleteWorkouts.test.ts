import { describe, expect, it } from "vitest";

import { AppError, ErrorCode } from "../errors";
import { isBulkDeleteWorkoutsNotFoundError } from "./bulkDeleteWorkouts";

describe("isBulkDeleteWorkoutsNotFoundError", () => {
  it("returns true for an AppError with NOT_FOUND code", () => {
    const error = new AppError(ErrorCode.NOT_FOUND, "Not found");
    expect(isBulkDeleteWorkoutsNotFoundError(error)).toBe(true);
  });

  it("returns false for an AppError with a different code", () => {
    const error = new AppError(ErrorCode.INTERNAL_ERROR, "Internal error");
    expect(isBulkDeleteWorkoutsNotFoundError(error)).toBe(false);
  });

  it("returns false for a standard Error", () => {
    const error = new Error("Standard error");
    expect(isBulkDeleteWorkoutsNotFoundError(error)).toBe(false);
  });

  it("returns false for a non-error value", () => {
    expect(isBulkDeleteWorkoutsNotFoundError("some string")).toBe(false);
    expect(isBulkDeleteWorkoutsNotFoundError(null)).toBe(false);
    expect(isBulkDeleteWorkoutsNotFoundError(undefined)).toBe(false);
    expect(isBulkDeleteWorkoutsNotFoundError({ code: ErrorCode.NOT_FOUND })).toBe(false);
  });
});
