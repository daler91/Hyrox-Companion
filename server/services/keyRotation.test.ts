import { randomBytes } from "node:crypto";

import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the credential re-encrypt sweep. Real crypto with a mocked env
 * (the cryptoRotation.test.ts loadCrypto pattern) so these prove GENUINE
 * v1 -> v2 migration, not mock choreography. The db is a minimal fluent stub
 * that records every UPDATE payload.
 */

const KEY_V1 = randomBytes(32).toString("hex");
const KEY_V2 = randomBytes(32).toString("hex");

// A parseable v1-tagged value whose payload cannot decrypt (auth-tag garbage):
// needsReencryption() says true, decryptToken() throws — the poison-row shape
// that used to abort the remainder of the sweep.
const CORRUPT_V1 = `v1:${"ab".repeat(12)}:${"cd".repeat(16)}:deadbeef`;

let stravaRows: Record<string, unknown>[] = [];
let garminRows: Record<string, unknown>[] = [];
let updates: { table: unknown; payload: Record<string, unknown> }[] = [];
let withPgAdvisoryLock: ReturnType<typeof vi.fn>;
let selectSpy: ReturnType<typeof vi.fn>;
let mockLogger: {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
};

// Mint ciphertext under a keyring that has ONLY v1 configured, so the value is
// v1-tagged and genuinely needs migration once v2 exists.
async function makeV1Cipher(plaintext: string): Promise<string> {
  vi.resetModules();
  vi.doMock("../env", () => ({ env: { ENCRYPTION_KEY: KEY_V1 } }));
  vi.doMock("../logger", () => ({ logger: mockLogger }));
  const { encryptToken } = await import("../crypto");
  return encryptToken(plaintext);
}

async function loadKeyRotation(envOverrides: Record<string, unknown> = {}) {
  vi.resetModules();
  vi.doMock("../env", () => ({
    env: { ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_V2: KEY_V2, ...envOverrides },
  }));
  vi.doMock("../logger", () => ({ logger: mockLogger }));
  vi.doMock("../advisoryLock", () => ({ withPgAdvisoryLock }));
  vi.doMock("../db", () => ({
    pool: {},
    db: {
      // Table identity must be checked BY NAME: vi.resetModules gives the
      // dynamically-imported keyRotation a fresh @shared/schema instance, so a
      // === comparison against this test file's table objects always fails.
      // getTableName reads the global Symbol.for registry, immune to resets.
      select: (selectSpy = vi.fn(() => ({
        from: (table: unknown) =>
          Promise.resolve(
            getTableName(table as PgTable) === "strava_connections" ? stravaRows : garminRows,
          ),
      }))),
      update: vi.fn((table: unknown) => ({
        set: (payload: Record<string, unknown>) => ({
          where: () => {
            updates.push({ table, payload });
            return Promise.resolve();
          },
        }),
      })),
    },
  }));
  const mod = await import("./keyRotation");
  const crypto = await import("../crypto"); // same mocked-env instance — for decrypt-back
  return { ...mod, crypto };
}

beforeEach(() => {
  stravaRows = [];
  garminRows = [];
  updates = [];
  mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  withPgAdvisoryLock = vi.fn(async (_pool, _opts, run: () => Promise<unknown>) => ({
    acquired: true,
    value: await run(),
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../env");
  vi.doUnmock("../logger");
  vi.doUnmock("../advisoryLock");
  vi.doUnmock("../db");
});

describe("reencryptStoredCredentials", () => {
  it("migrates v1 ciphertext to v2 and the result decrypts to the original plaintext", async () => {
    const acc = await makeV1Cipher("strava-access");
    const ref = await makeV1Cipher("strava-refresh");
    const email = await makeV1Cipher("a@example.com");
    const pw = await makeV1Cipher("pw");
    const oauth2 = await makeV1Cipher("garmin-oauth2");
    const { reencryptStoredCredentials, crypto } = await loadKeyRotation();
    stravaRows = [{ id: "s1", accessToken: acc, refreshToken: ref }];
    garminRows = [
      {
        id: "g1",
        encryptedEmail: email,
        encryptedPassword: pw,
        encryptedOauth1Token: null,
        encryptedOauth2Token: oauth2,
      },
    ];

    const summary = await reencryptStoredCredentials();

    expect(summary).toEqual({ stravaUpdated: 1, garminUpdated: 1, failed: 0 });
    expect(updates).toHaveLength(2);
    const stravaPayload = updates[0].payload;
    expect(String(stravaPayload.accessToken)).toMatch(/^v2:/);
    expect(String(stravaPayload.refreshToken)).toMatch(/^v2:/);
    expect(crypto.decryptToken(stravaPayload.accessToken as string)).toBe("strava-access");
    expect(crypto.decryptToken(stravaPayload.refreshToken as string)).toBe("strava-refresh");
    const garminPayload = updates[1].payload;
    expect(String(garminPayload.encryptedEmail)).toMatch(/^v2:/);
    expect(crypto.decryptToken(garminPayload.encryptedOauth2Token as string)).toBe(
      "garmin-oauth2",
    );
  });

  it("issues zero UPDATEs when every row is already on the current version", async () => {
    const { reencryptStoredCredentials, crypto } = await loadKeyRotation();
    stravaRows = [
      { id: "s1", accessToken: crypto.encryptToken("acc"), refreshToken: crypto.encryptToken("ref") },
    ];
    garminRows = [];

    const summary = await reencryptStoredCredentials();

    expect(summary).toEqual({ stravaUpdated: 0, garminUpdated: 0, failed: 0 });
    expect(updates).toHaveLength(0);
  });

  it("writes all four garmin columns when only one needed migration", async () => {
    const staleOauth2 = await makeV1Cipher("o2");
    const { reencryptStoredCredentials, crypto } = await loadKeyRotation();
    const freshEmail = crypto.encryptToken("a@example.com");
    const freshPw = crypto.encryptToken("pw");
    garminRows = [
      {
        id: "g1",
        encryptedEmail: freshEmail,
        encryptedPassword: freshPw,
        encryptedOauth1Token: null,
        encryptedOauth2Token: staleOauth2,
      },
    ];

    const summary = await reencryptStoredCredentials();

    expect(summary).toEqual({ stravaUpdated: 0, garminUpdated: 1, failed: 0 });
    expect(updates).toHaveLength(1);
    const payload = updates[0].payload;
    expect(Object.keys(payload).sort()).toEqual([
      "encryptedEmail",
      "encryptedOauth1Token",
      "encryptedOauth2Token",
      "encryptedPassword",
    ]);
    // Unchanged columns pass through byte-identical; null stays null.
    expect(payload.encryptedEmail).toBe(freshEmail);
    expect(payload.encryptedPassword).toBe(freshPw);
    expect(payload.encryptedOauth1Token).toBeNull();
    expect(String(payload.encryptedOauth2Token)).toMatch(/^v2:/);
  });

  it("silently skips malformed non-versioned values", async () => {
    const { reencryptStoredCredentials } = await loadKeyRotation();
    stravaRows = [{ id: "s1", accessToken: "plain-junk", refreshToken: null }];

    const summary = await reencryptStoredCredentials();

    expect(summary).toEqual({ stravaUpdated: 0, garminUpdated: 0, failed: 0 });
    expect(updates).toHaveLength(0);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("logs, counts, and skips a corrupt versioned row while the rest of the sweep continues", async () => {
    const good = await makeV1Cipher("good-token");
    const garminEmail = await makeV1Cipher("g@example.com");
    const { reencryptStoredCredentials, crypto } = await loadKeyRotation();
    stravaRows = [
      { id: "bad", accessToken: CORRUPT_V1, refreshToken: null },
      { id: "good", accessToken: good, refreshToken: null },
    ];
    garminRows = [
      {
        id: "g1",
        encryptedEmail: garminEmail,
        encryptedPassword: crypto.encryptToken("pw"),
        encryptedOauth1Token: null,
        encryptedOauth2Token: null,
      },
    ];

    const summary = await reencryptStoredCredentials();

    // Pre-fix this was { stravaUpdated: 0, garminUpdated: 0 } with a thrown
    // sweep — the poison row aborted everything after it, garmin included.
    expect(summary).toEqual({ stravaUpdated: 1, garminUpdated: 1, failed: 1 });
    expect(updates).toHaveLength(2);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ table: "strava_connections", id: "bad" }),
      expect.stringContaining("failed re-encryption"),
    );
  });

  it("returns null with zero reads or writes when the advisory lock is not acquired", async () => {
    withPgAdvisoryLock = vi.fn().mockResolvedValue({ acquired: false, value: undefined });
    const { reencryptStoredCredentials } = await loadKeyRotation();

    const summary = await reencryptStoredCredentials();

    expect(summary).toBeNull();
    expect(selectSpy).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("single-flights under the reserved key-rotation advisory lock", async () => {
    const { reencryptStoredCredentials } = await loadKeyRotation();
    await reencryptStoredCredentials();

    expect(withPgAdvisoryLock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ key: 42_010_009n, name: "keyRotationReencrypt" }),
      expect.any(Function),
    );
  });
});

describe("maybeReencryptOnBoot", () => {
  it("no-ops without a v2 key or without the opt-in flag", async () => {
    const noV2 = await loadKeyRotation({ ENCRYPTION_KEY_V2: undefined });
    await noV2.maybeReencryptOnBoot();
    expect(withPgAdvisoryLock).not.toHaveBeenCalled();

    const noFlag = await loadKeyRotation(); // ENCRYPTION_REENCRYPT_ON_BOOT unset
    await noFlag.maybeReencryptOnBoot();
    expect(withPgAdvisoryLock).not.toHaveBeenCalled();
  });

  it("never throws when the sweep fails, and logs the error", async () => {
    withPgAdvisoryLock = vi.fn().mockRejectedValue(new Error("db down"));
    const { maybeReencryptOnBoot } = await loadKeyRotation({
      ENCRYPTION_REENCRYPT_ON_BOOT: "true",
    });

    await expect(maybeReencryptOnBoot()).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("logs the summary at warn level when rows were skipped", async () => {
    const good = await makeV1Cipher("t");
    const { maybeReencryptOnBoot } = await loadKeyRotation({
      ENCRYPTION_REENCRYPT_ON_BOOT: "true",
    });
    stravaRows = [
      { id: "bad", accessToken: CORRUPT_V1, refreshToken: null },
      { id: "good", accessToken: good, refreshToken: null },
    ];

    await maybeReencryptOnBoot();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stravaUpdated: 1, failed: 1 }),
      "Re-encrypted stored credentials to current key version",
    );
  });
});
