import { beforeEach,describe, expect, it, vi } from "vitest";

describe("db.ts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws if DATABASE_URL is not set", async () => {
    vi.doMock("./env", () => ({
      env: {
        DATABASE_URL: "",
      }
    }));
    await expect(import("./db")).rejects.toThrow("DATABASE_URL must be set");
  });

  it("sets ssl.rejectUnauthorized = true for external production hosts", async () => {
    let poolConfig: any;
    vi.doMock("pg", () => {
      return {
        default: {
          Pool: class Pool {
            constructor(config: any) {
              poolConfig = config;
            }
            on = vi.fn();
          }
        }
      };
    });

    vi.doMock("./env", () => ({
      env: {
        DATABASE_URL: "postgres://user:pass@external-host.com:5432/db",
        NODE_ENV: "production"
      }
    }));

    await import("./db");

    expect(poolConfig.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("sets ssl = false for internal production hosts (.railway.internal)", async () => {
    let poolConfig: any;
    vi.doMock("pg", () => {
      return {
        default: {
          Pool: class Pool {
            constructor(config: any) {
              poolConfig = config;
            }
            on = vi.fn();
          }
        }
      };
    });

    vi.doMock("./env", () => ({
      env: {
        DATABASE_URL: "postgres://user:pass@my-db.railway.internal:5432/db",
        NODE_ENV: "production"
      }
    }));

    await import("./db");

    expect(poolConfig.ssl).toBe(false);
  });

  it("sets ssl = false in non-production environments", async () => {
    let poolConfig: any;
    vi.doMock("pg", () => {
      return {
        default: {
          Pool: class Pool {
            constructor(config: any) {
              poolConfig = config;
            }
            on = vi.fn();
          }
        }
      };
    });

    vi.doMock("./env", () => ({
      env: {
        DATABASE_URL: "postgres://user:pass@external-host.com:5432/db",
        NODE_ENV: "development"
      }
    }));

    await import("./db");

    expect(poolConfig.ssl).toBe(false);
  });

  it("sets ssl.rejectUnauthorized = true if URL parsing fails in production (safe fallback)", async () => {
    let poolConfig: any;
    vi.doMock("pg", () => {
      return {
        default: {
          Pool: class Pool {
            constructor(config: any) {
              poolConfig = config;
            }
            on = vi.fn();
          }
        }
      };
    });

    vi.doMock("./env", () => ({
      env: {
        // This will cause new URL() to throw and fall into the catch block returning false
        // then `!isInternalHost` is true, so ssl = { rejectUnauthorized: true }
        DATABASE_URL: "not-a-valid-url",
        NODE_ENV: "production"
      }
    }));

    await import("./db");

    expect(poolConfig.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("handles pool error events", async () => {
    const onMock = vi.fn();
    vi.doMock("pg", () => {
      return {
        default: {
          Pool: class Pool {
            on = onMock;
          }
        }
      };
    });

    vi.doMock("./env", () => ({
      env: {
        DATABASE_URL: "postgres://user:pass@host:5432/db",
        NODE_ENV: "test"
      }
    }));

    const mockLoggerError = vi.fn();
    vi.doMock("./logger", () => ({
      logger: {
        error: mockLoggerError
      }
    }));

    await import("./db");

    expect(onMock).toHaveBeenCalledWith("error", expect.any(Function));

    const errorHandler = onMock.mock.calls.find(c => c[0] === "error")[1];
    const testError = new Error("Test pool error");
    errorHandler(testError);

    expect(mockLoggerError).toHaveBeenCalledWith(
      { err: testError, context: "db" },
      "Unexpected error on idle database client"
    );
  });
});
