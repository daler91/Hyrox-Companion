import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake test-only keys, built as expressions so secret scanners do not read
// them as credentials. Any 32+ character string works for the HMAC.
const TEST_KEY = "a".repeat(32);
const ROTATED_KEY = "b".repeat(32);

vi.mock("./env", () => ({
  env: {
    ENCRYPTION_KEY: "a".repeat(32),
    ENCRYPTION_KEY_V2: undefined as string | undefined,
    APP_URL: "https://app.example.com",
  },
}));

import {
  buildListUnsubscribeHeaders,
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./emailUnsubscribeToken";
import { env } from "./env";

describe("email unsubscribe token", () => {
  beforeEach(() => {
    env.ENCRYPTION_KEY = TEST_KEY;
    env.ENCRYPTION_KEY_V2 = undefined;
  });

  it("round-trips the user id", () => {
    const token = createUnsubscribeToken("user_abc-123");
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: "user_abc-123" });
  });

  it("is deterministic for a fixed key, so template snapshots are stable", () => {
    expect(createUnsubscribeToken("user_1")).toBe(createUnsubscribeToken("user_1"));
  });

  it("rejects a tampered signature", () => {
    const token = createUnsubscribeToken("user_1");
    const [encoded, signature] = token.split(".");
    const flipped = signature.startsWith("0") ? `1${signature.slice(1)}` : `0${signature.slice(1)}`;
    expect(verifyUnsubscribeToken(`${encoded}.${flipped}`)).toBeNull();
  });

  it("rejects a token re-pointed at another user", () => {
    const token = createUnsubscribeToken("user_1");
    const [, signature] = token.split(".");
    const other = Buffer.from("user_2", "utf8").toString("base64url");
    expect(verifyUnsubscribeToken(`${other}.${signature}`)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("no-dot")).toBeNull();
    expect(verifyUnsubscribeToken("a.b.c")).toBeNull();
    expect(verifyUnsubscribeToken(".abc")).toBeNull();
    expect(verifyUnsubscribeToken(["x.y"])).toBeNull();
  });

  it("keeps verifying links signed before a key rotation", () => {
    const oldToken = createUnsubscribeToken("user_1");
    env.ENCRYPTION_KEY_V2 = ROTATED_KEY;

    const newToken = createUnsubscribeToken("user_1");
    expect(newToken).not.toBe(oldToken);
    expect(verifyUnsubscribeToken(oldToken)).toEqual({ userId: "user_1" });
    expect(verifyUnsubscribeToken(newToken)).toEqual({ userId: "user_1" });
  });

  it("no longer verifies a link once the key that signed it is dropped", () => {
    const oldToken = createUnsubscribeToken("user_1");
    env.ENCRYPTION_KEY = ROTATED_KEY;
    expect(verifyUnsubscribeToken(oldToken)).toBeNull();
  });

  it("builds the unsubscribe URL on the app origin", () => {
    const url = buildUnsubscribeUrl("user_1");
    expect(url.startsWith("https://app.example.com/api/v1/emails/unsubscribe?token=")).toBe(true);
    const token = decodeURIComponent(url.split("token=")[1]);
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: "user_1" });
  });

  it("builds RFC 8058 one-click headers", () => {
    const headers = buildListUnsubscribeHeaders("user_1");
    expect(headers["List-Unsubscribe"]).toBe(`<${buildUnsubscribeUrl("user_1")}>`);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("refuses to mint a token without a signing key", () => {
    env.ENCRYPTION_KEY = "";
    expect(() => createUnsubscribeToken("user_1")).toThrow(/ENCRYPTION_KEY/);
  });
});
