import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const baseEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/fitai",
  ENCRYPTION_KEY: "f".repeat(64),
};

describe("env topology settings", () => {
  // Tech debt #48: APP_INSTANCE_COUNT was validated but read by no code; the
  // Postgres-backed shared state is always on. A deployment that still sets it
  // must keep booting, so the variable is ignored rather than rejected.
  it("ignores a leftover APP_INSTANCE_COUNT", () => {
    const env = parseEnv({ ...baseEnv, APP_INSTANCE_COUNT: "3" });

    expect(env).not.toHaveProperty("APP_INSTANCE_COUNT");
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

describe("env RAG chunking", () => {
  it("defaults to 600-character chunks overlapping by 100", () => {
    const env = parseEnv(baseEnv);

    expect(env.RAG_CHUNK_SIZE).toBe(600);
    expect(env.RAG_CHUNK_OVERLAP).toBe(100);
  });

  it("accepts a positive whole chunk size with a smaller, non-negative overlap", () => {
    const env = parseEnv({ ...baseEnv, RAG_CHUNK_SIZE: "1200", RAG_CHUNK_OVERLAP: "0" });

    expect(env.RAG_CHUNK_SIZE).toBe(1200);
    expect(env.RAG_CHUNK_OVERLAP).toBe(0);
  });

  it.each(["0", "-50"])("rejects a chunk size of %s, which never advances the chunker", (size) => {
    expect(() => parseEnv({ ...baseEnv, RAG_CHUNK_SIZE: size, RAG_CHUNK_OVERLAP: "0" })).toThrow(
      /RAG_CHUNK_SIZE must be greater than 0/,
    );
  });

  it("rejects a fractional chunk size", () => {
    expect(() => parseEnv({ ...baseEnv, RAG_CHUNK_SIZE: "600.5" })).toThrow(/RAG_CHUNK_SIZE must be a whole number/);
  });

  it("rejects a negative overlap, which would skip text between chunks", () => {
    expect(() => parseEnv({ ...baseEnv, RAG_CHUNK_OVERLAP: "-1" })).toThrow(/RAG_CHUNK_OVERLAP cannot be negative/);
  });

  it("rejects an overlap as long as the chunk", () => {
    expect(() => parseEnv({ ...baseEnv, RAG_CHUNK_SIZE: "500", RAG_CHUNK_OVERLAP: "500" })).toThrow(
      /RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE/,
    );
  });
});

// Tech debt #49: ENCRYPTION_KEY was required, so after a rotation to
// ENCRYPTION_KEY_V2 the old key could never be removed.
describe("env encryption keys", () => {
  const { ENCRYPTION_KEY: _v1, ...withoutV1 } = baseEnv;

  it("accepts ENCRYPTION_KEY_V2 alone, once the v1 key is retired", () => {
    const env = parseEnv({ ...withoutV1, ENCRYPTION_KEY_V2: "a".repeat(64) });

    expect(env.ENCRYPTION_KEY).toBeUndefined();
    expect(env.ENCRYPTION_KEY_V2).toBe("a".repeat(64));
  });

  it("refuses to start with neither key", () => {
    expect(() => parseEnv(withoutV1)).toThrow();
  });

  it("still requires the two keys to differ when both are set", () => {
    expect(() => parseEnv({ ...baseEnv, ENCRYPTION_KEY_V2: baseEnv.ENCRYPTION_KEY })).toThrow();
  });
});
