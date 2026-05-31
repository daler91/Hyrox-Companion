import { beforeEach, describe, expect, it, vi } from "vitest";

// The event emitter we will return from our mock pg.Pool constructor
class MockPool {
  options: any;
  listeners: Record<string, ((...args: any[]) => void)[]> = {};

  constructor(options: any) {
    this.options = options;
  }

  on(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return this;
  }

  emit(event: string, ...args: any[]) {
    if (this.listeners[event]) {
      for (const listener of this.listeners[event]) {
        listener(...args);
      }
    }
  }
}

// Mock the dependencies using classes so they can be instantiated with `new`
vi.mock("pg", () => {
  return {
    default: {
      Pool: class extends MockPool {}
    }
  };
});

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn().mockReturnValue({
    transaction: vi.fn()
  })
}));

// We must mock schema because drizzle-orm needs it
vi.mock("@shared/schema", () => ({
  default: {}
}));

// We can partially mock logger
const mockLogError = vi.fn();
vi.mock("./logger", () => ({
  logger: {
    error: mockLogError
  }
}));

describe("db.ts initialization", () => {
  let envMock: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    mockLogError.mockClear();

    // Default env for successful import
    envMock = {
      DATABASE_URL: "postgres://dummy:dummy@localhost:5432/dummy",
      NODE_ENV: "development",
    };

    // We mock `env` before importing `db` in each test.
    vi.doMock("./env", () => ({
      env: envMock,
    }));
  });

  it("throws an error if DATABASE_URL is not set", async () => {
    envMock.DATABASE_URL = "";

    await expect(import("./db")).rejects.toThrow(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  });

  it("configures the pg.Pool with default timeouts and options", async () => {
    const dbModule = await import("./db");
    const { DB_CONNECTION_TIMEOUT_MS, DB_IDLE_TIMEOUT_MS, DB_STATEMENT_TIMEOUT_MS } = await import("./constants");

    // The exported pool should be our mock
    const pool = dbModule.pool as unknown as MockPool;

    expect(pool.options).toEqual(expect.objectContaining({
      connectionString: envMock.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
      statement_timeout: DB_STATEMENT_TIMEOUT_MS,
    }));
  });

  describe("SSL configuration", () => {
    it("disables SSL when not in production", async () => {
      envMock.NODE_ENV = "development";
      const dbModule = await import("./db");
      const pool = dbModule.pool as unknown as MockPool;

      expect(pool.options.ssl).toBe(false);
    });

    it("requires SSL (rejectUnauthorized) for external hosts in production", async () => {
      envMock.NODE_ENV = "production";
      envMock.DATABASE_URL = "postgres://user:pass@external.host.com:5432/db";

      const dbModule = await import("./db");
      const pool = dbModule.pool as unknown as MockPool;

      expect(pool.options.ssl).toEqual({ rejectUnauthorized: true });
    });

    it("disables SSL for internal railway hosts in production", async () => {
      envMock.NODE_ENV = "production";
      envMock.DATABASE_URL = "postgres://user:pass@viaduct.proxy.rlwy.net.railway.internal:5432/railway";

      const dbModule = await import("./db");
      const pool = dbModule.pool as unknown as MockPool;

      expect(pool.options.ssl).toBe(false);
    });

    it("disables SSL if URL parsing fails (fallback internal host check)", async () => {
      envMock.NODE_ENV = "production";
      // An invalid URL that causes new URL() to throw
      envMock.DATABASE_URL = "invalid-url";

      // We expect it to NOT be an internal host, because the catch block returns `false`.
      // Which means `!isInternalHost` is true, so it SHOULD enforce SSL.
      const dbModule = await import("./db");
      const pool = dbModule.pool as unknown as MockPool;

      expect(pool.options.ssl).toEqual({ rejectUnauthorized: true });
    });
  });

  it("logs unexpected errors on the idle pool", async () => {
    const dbModule = await import("./db");
    const pool = dbModule.pool as unknown as MockPool;

    const testError = new Error("Connection dropped");
    pool.emit("error", testError);

    expect(mockLogError).toHaveBeenCalledWith(
      { err: testError, context: "db" },
      "Unexpected error on idle database client"
    );
  });
});
