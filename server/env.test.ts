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

describe("env LOG_LEVEL", () => {
  it("defaults LOG_LEVEL to info", () => {
    expect(parseEnv(baseEnv).LOG_LEVEL).toBe("info");
  });

  it("accepts pino level names", () => {
    expect(parseEnv({ ...baseEnv, LOG_LEVEL: "warn" }).LOG_LEVEL).toBe("warn");
  });

  it("rejects an unknown level with a message naming the variable", () => {
    expect(() => parseEnv({ ...baseEnv, LOG_LEVEL: "warning" })).toThrow(
      /LOG_LEVEL must be one of/,
    );
  });
});

describe("env native app settings", () => {
  const FINGERPRINT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");

  it("accepts an Android package with one or more certificate fingerprints", () => {
    const env = parseEnv({
      ...baseEnv,
      ANDROID_APP_PACKAGE: "com.fitai.coach",
      ANDROID_APP_CERT_SHA256: `${FINGERPRINT}, ${FINGERPRINT.toLowerCase()}`,
    });

    expect(env.ANDROID_APP_PACKAGE).toBe("com.fitai.coach");
  });

  it("refuses half an App Links config", () => {
    expect(() => parseEnv({ ...baseEnv, ANDROID_APP_PACKAGE: "com.fitai.coach" })).toThrow(/must be set together/);
    expect(() => parseEnv({ ...baseEnv, ANDROID_APP_CERT_SHA256: FINGERPRINT })).toThrow(/must be set together/);
  });

  it("rejects a fingerprint that is not 32 colon-separated bytes", () => {
    expect(() =>
      parseEnv({ ...baseEnv, ANDROID_APP_PACKAGE: "com.fitai.coach", ANDROID_APP_CERT_SHA256: "AB:CD:EF" }),
    ).toThrow(/ANDROID_APP_CERT_SHA256 must be/);
  });

  it("rejects a malformed package name", () => {
    expect(() =>
      parseEnv({ ...baseEnv, ANDROID_APP_PACKAGE: "fitai", ANDROID_APP_CERT_SHA256: FINGERPRINT }),
    ).toThrow(/ANDROID_APP_PACKAGE must be/);
  });

  it("accepts MAJOR.MINOR.PATCH app minimums and rejects anything else", () => {
    expect(parseEnv({ ...baseEnv, MIN_APP_VERSION_ANDROID: "1.4.0" }).MIN_APP_VERSION_ANDROID).toBe("1.4.0");
    expect(() => parseEnv({ ...baseEnv, MIN_APP_VERSION_IOS: "1.4" })).toThrow(/MIN_APP_VERSION_IOS must look like/);
  });
});
