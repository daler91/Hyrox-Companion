import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to mock dependencies before importing the module

// Mock logger
vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock pg Pool
const mockOn = vi.fn();
class MockPool {
  constructor(config: any) {
    // Record instantiation with config
    (MockPool as any).lastConfig = config;
    (MockPool as any).instances.push(this);
  }
  on = mockOn;
}
(MockPool as any).instances = [];
(MockPool as any).lastConfig = null;

vi.mock("pg", () => ({
  default: {
    Pool: MockPool,
  },
}));

// Mock env
vi.mock("./env", () => ({
  env: {
    VECTOR_DATABASE_URL: "",
    DATABASE_URL: "postgres://main-db-url",
    NODE_ENV: "development",
  },
}));

import { env } from "./env";
import { logger } from "./logger";

describe("vectorDb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (MockPool as any).instances = [];
    (MockPool as any).lastConfig = null;
  });

  afterEach(() => {
    // Reset env values
    env.VECTOR_DATABASE_URL = "";
    env.DATABASE_URL = "postgres://main-db-url";
    env.NODE_ENV = "development";
  });

  it("should initialize vectorPool with main DATABASE_URL when VECTOR_DATABASE_URL is not set", async () => {
    env.VECTOR_DATABASE_URL = "";
    env.DATABASE_URL = "postgres://main-db-url";

    const vectorDb = await import("./vectorDb");

    expect((MockPool as any).lastConfig).toEqual(expect.objectContaining({
      connectionString: "postgres://main-db-url",
      ssl: false,
    }));

    expect(vectorDb.isVectorDbSeparate).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      { context: "db", separate: false },
      "Vector DB using main DATABASE_URL (single-DB mode)"
    );
  });

  it("should initialize vectorPool with VECTOR_DATABASE_URL when set", async () => {
    env.VECTOR_DATABASE_URL = "postgres://vector-db-url";
    env.DATABASE_URL = "postgres://main-db-url";

    const vectorDb = await import("./vectorDb");

    expect((MockPool as any).lastConfig).toEqual(expect.objectContaining({
      connectionString: "postgres://vector-db-url",
      ssl: false,
    }));

    expect(vectorDb.isVectorDbSeparate).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      { context: "db", separate: true },
      "Vector DB configured (separate Neon instance)"
    );
  });

  it("should use ssl true when NODE_ENV is production", async () => {
    env.NODE_ENV = "production";

    await import("./vectorDb");

    expect((MockPool as any).lastConfig).toEqual(expect.objectContaining({
      ssl: { rejectUnauthorized: true },
    }));
  });

  it("should log error when vectorPool emits error", async () => {
    await import("./vectorDb");

    // Trigger error
    expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));

    const errorCallback = mockOn.mock.calls.find(call => call[0] === "error")![1];

    const mockError = new Error("db error");
    errorCallback(mockError);

    expect(logger.error).toHaveBeenCalledWith(
      { err: mockError, context: "vectorDb" },
      "Unexpected error on idle vector DB client"
    );
  });
});
