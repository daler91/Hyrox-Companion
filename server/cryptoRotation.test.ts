import { afterEach, describe, expect, it, vi } from "vitest";

// 64 hex chars = 32 bytes each, distinct, none in the weak-key denylist.
const KEY_V1 = "1111111111111111111111111111111111111111111111111111111111111111";
const KEY_V2 = "2222222222222222222222222222222222222222222222222222222222222222";

async function loadCrypto(envOverrides: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("./env", () => ({ env: envOverrides }));
  return import("./crypto");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./env");
});

describe("crypto key rotation (W6)", () => {
  it("tags ciphertext v1 when only ENCRYPTION_KEY is set", async () => {
    const { encryptToken, currentKeyVersion } = await loadCrypto({ ENCRYPTION_KEY: KEY_V1 });
    expect(currentKeyVersion()).toBe("v1");
    expect(encryptToken("secret").startsWith("v1:")).toBe(true);
  });

  it("encrypts with v2 yet still decrypts pre-rotation v1 ciphertext", async () => {
    const before = await loadCrypto({ ENCRYPTION_KEY: KEY_V1 });
    const v1Cipher = before.encryptToken("strava-refresh-token");
    expect(v1Cipher.startsWith("v1:")).toBe(true);

    const after = await loadCrypto({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_V2: KEY_V2 });
    expect(after.currentKeyVersion()).toBe("v2");
    expect(after.encryptToken("new").startsWith("v2:")).toBe(true);
    // Cross-version decrypt: the retired v1 key is still in the keyring.
    expect(after.decryptToken(v1Cipher)).toBe("strava-refresh-token");
  });

  it("reencryptToken migrates v1 → v2 and is idempotent on current ciphertext", async () => {
    const before = await loadCrypto({ ENCRYPTION_KEY: KEY_V1 });
    const v1Cipher = before.encryptToken("secret");

    const after = await loadCrypto({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_V2: KEY_V2 });
    expect(after.needsReencryption(v1Cipher)).toBe(true);

    const migrated = after.reencryptToken(v1Cipher);
    expect(migrated.startsWith("v2:")).toBe(true);
    expect(after.decryptToken(migrated)).toBe("secret");

    // Already current → not flagged and returned unchanged.
    expect(after.needsReencryption(migrated)).toBe(false);
    expect(after.reencryptToken(migrated)).toBe(migrated);
  });

  it("still decrypts legacy unversioned ciphertext via the v1 slot", async () => {
    // A v1-tagged ciphertext with the version prefix stripped mimics the legacy
    // 3-part format that predates versioning.
    const before = await loadCrypto({ ENCRYPTION_KEY: KEY_V1 });
    const legacy = before.encryptToken("legacy").replace(/^v1:/, "");
    expect(legacy.split(":").length).toBe(3);

    const after = await loadCrypto({ ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_V2: KEY_V2 });
    expect(after.decryptToken(legacy)).toBe("legacy");
    // Legacy is treated as v1, so it is flagged for migration after rotation.
    expect(after.needsReencryption(legacy)).toBe(true);
  });
});
