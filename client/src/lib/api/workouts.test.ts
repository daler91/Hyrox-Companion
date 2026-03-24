import { describe, it, expect, vi, beforeEach } from "vitest";
import { workouts } from "./workouts";
import { typedRequest } from "./client";

vi.mock("./client", () => ({
  typedRequest: vi.fn(),
}));

describe("workouts API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create() calls typedRequest with POST and correct data", () => {
    const data = { title: "Test Workout", rawText: "I did something" };
    workouts.create(data as any);
    expect(typedRequest).toHaveBeenCalledWith("POST", "/api/v1/workouts", data);
  });

  it("list() calls typedRequest with GET and empty query string when no params provided", () => {
    workouts.list();
    expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/workouts");
  });

  it("list() calls typedRequest with GET and correct query string when params provided", () => {
    workouts.list({ limit: 10, offset: 5 });
    expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/workouts?limit=10&offset=5");
  });

  it("list() filters out null or undefined params from query string", () => {
    workouts.list({ limit: 10, offset: undefined });
    expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/workouts?limit=10");
  });

  it("get() calls typedRequest with GET and correct id", () => {
    workouts.get("123");
    expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/workouts/123");
  });

  it("update() calls typedRequest with PATCH and correct id and data", () => {
    const data = { title: "Updated Workout" };
    workouts.update("123", data as any);
    expect(typedRequest).toHaveBeenCalledWith("PATCH", "/api/v1/workouts/123", data);
  });

  it("delete() calls typedRequest with DELETE and correct id", () => {
    workouts.delete("123");
    expect(typedRequest).toHaveBeenCalledWith("DELETE", "/api/v1/workouts/123");
  });

  it("getUnstructured() calls typedRequest with GET", () => {
    workouts.getUnstructured();
    expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/workouts/unstructured");
  });

  it("reparse() calls typedRequest with POST and correct id", () => {
    workouts.reparse("123");
    expect(typedRequest).toHaveBeenCalledWith("POST", "/api/v1/workouts/123/reparse");
  });

  it("batchReparse() calls typedRequest with POST", () => {
    workouts.batchReparse();
    expect(typedRequest).toHaveBeenCalledWith("POST", "/api/v1/workouts/batch-reparse");
  });
});
