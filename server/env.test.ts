import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const baseEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/fitai",
  ENCRYPTION_KEY: "f".repeat(64),
};

describe("env topology settings", () => {
  it("defaults APP_INSTANCE_COUNT to one", () => {
    const env = parseEnv(baseEnv);

    expect(env.APP_INSTANCE_COUNT).toBe(1);
  });

  it("accepts positive integer APP_INSTANCE_COUNT values outside production", () => {
    const env = parseEnv({ ...baseEnv, APP_INSTANCE_COUNT: "3", NODE_ENV: "test" });

    expect(env.APP_INSTANCE_COUNT).toBe(3);
  });

  it("rejects non-positive APP_INSTANCE_COUNT values", () => {
    expect(() => parseEnv({ ...baseEnv, APP_INSTANCE_COUNT: "0" })).toThrow();
  });

  it("accepts production multi-instance declarations", () => {
    const env = parseEnv({
      ...baseEnv,
      APP_INSTANCE_COUNT: "2",
      CSRF_SECRET: "e".repeat(64),
      NODE_ENV: "production",
    });

    expect(env.APP_INSTANCE_COUNT).toBe(2);
  });
});
