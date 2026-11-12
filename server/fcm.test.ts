import { createVerify, generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "fitai-coach-test",
  client_email: "push@fitai-coach-test.iam.gserviceaccount.com",
  private_key: privateKey,
  // Never used: the token endpoint is a constant in fcm.ts.
  token_uri: "https://attacker.example/token",
};

const mockEnv = vi.hoisted((): { FCM_SERVICE_ACCOUNT_JSON?: string } => ({}));
vi.mock("./env", () => ({ env: mockEnv }));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  buildAssertion,
  buildFcmMessage,
  isFcmConfigured,
  isStaleTokenError,
  resetFcmAccessToken,
  sendFcmMessage,
} from "./fcm";
import { parseFcmServiceAccount } from "./fcmServiceAccount";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://fcm.googleapis.com/v1/projects/fitai-coach-test/messages:send";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const accessTokenResponse = () => jsonResponse(200, { access_token: "ya29.access", expires_in: 3600, token_type: "Bearer" });

describe("buildAssertion", () => {
  it("signs an RS256 JWT for the service account, scoped to FCM and addressed to Google's token endpoint", () => {
    const account = parseFcmServiceAccount(JSON.stringify(SERVICE_ACCOUNT))!;

    const jwt = buildAssertion(account, 1_800_000_000);
    const [header, claims, signature] = jwt.split(".");

    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: SERVICE_ACCOUNT.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: TOKEN_URL,
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const valid = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    expect(valid).toBe(true);
  });
});

describe("parseFcmServiceAccount", () => {
  it("accepts a key file", () => {
    expect(parseFcmServiceAccount(JSON.stringify(SERVICE_ACCOUNT))).toEqual({
      projectId: SERVICE_ACCOUNT.project_id,
      clientEmail: SERVICE_ACCOUNT.client_email,
      privateKey,
    });
  });

  it.each([
    ["unset", undefined],
    ["not JSON", "{not json"],
    ["a JSON string", '"key"'],
    ["missing private_key", JSON.stringify({ ...SERVICE_ACCOUNT, private_key: undefined })],
    ["a project id with a path in it", JSON.stringify({ ...SERVICE_ACCOUNT, project_id: "x/../../y" })],
  ])("rejects %s", (_label, value) => {
    expect(parseFcmServiceAccount(value)).toBeNull();
  });
});

describe("buildFcmMessage", () => {
  it("carries title and body as the notification, url and category as string data, and the channel for Android", () => {
    expect(buildFcmMessage("tok", { title: "T", body: "B", url: "/nutrition", category: "nutrition" })).toEqual({
      message: {
        token: "tok",
        notification: { title: "T", body: "B" },
        data: { url: "/nutrition", category: "nutrition" },
        android: { priority: "high", notification: { channel_id: "nutrition" } },
      },
    });
  });

  it("defaults the url to the app root and leaves the channel to the app without a category", () => {
    expect(buildFcmMessage("tok", { title: "T", body: "B" })).toEqual({
      message: {
        token: "tok",
        notification: { title: "T", body: "B" },
        data: { url: "/" },
        android: { priority: "high" },
      },
    });
  });
});

describe("isStaleTokenError", () => {
  type FcmErrorDetail = { errorCode?: string; fieldViolations?: Array<{ field?: string; description?: string }> };
  const fcmError = (status: string, details: FcmErrorDetail[]) => ({ error: { status, details } });

  it("prunes an UNREGISTERED token (app uninstalled or token rotated)", () => {
    expect(isStaleTokenError(404, fcmError("NOT_FOUND", [{ errorCode: "UNREGISTERED" }]))).toBe(true);
  });

  it("prunes a token FCM rejected as malformed", () => {
    const body = fcmError("INVALID_ARGUMENT", [
      { errorCode: "INVALID_ARGUMENT" },
      { fieldViolations: [{ field: "message.token", description: "Invalid registration token" }] },
    ]);
    expect(isStaleTokenError(400, body)).toBe(true);
  });

  it("keeps the token when the message, not the token, was invalid", () => {
    const body = fcmError("INVALID_ARGUMENT", [{ fieldViolations: [{ field: "message.data" }] }]);
    expect(isStaleTokenError(400, body)).toBe(false);
  });

  it.each([
    ["SENDER_ID_MISMATCH", 403, fcmError("PERMISSION_DENIED", [{ errorCode: "SENDER_ID_MISMATCH" }])],
    ["a bare 404", 404, fcmError("NOT_FOUND", [])],
    ["a 403", 403, fcmError("PERMISSION_DENIED", [])],
    ["an unreadable body", 500, null],
  ])("does not prune on %s, which a wrong Firebase project would return for every token", (_label, status, body) => {
    expect(isStaleTokenError(status, body)).toBe(false);
  });
});

describe("sendFcmMessage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockEnv.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SERVICE_ACCOUNT);
    resetFcmAccessToken();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is unconfigured without a service account, and sends nothing", async () => {
    delete mockEnv.FCM_SERVICE_ACCOUNT_JSON;

    expect(isFcmConfigured()).toBe(false);
    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trades the assertion for an access token at the constant endpoint, then sends with it", async () => {
    fetchMock.mockResolvedValueOnce(accessTokenResponse()).mockResolvedValueOnce(jsonResponse(200, { name: "m/1" }));

    const result = await sendFcmMessage("row-1", "tok", { title: "T", body: "B", url: "/" });

    expect(result).toBe("sent");
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe(TOKEN_URL);
    const form = tokenInit.body as URLSearchParams;
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);
    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(sendUrl).toBe(SEND_URL);
    expect((sendInit.headers as Record<string, string>).Authorization).toBe("Bearer ya29.access");
    expect((JSON.parse(sendInit.body as string) as { message: { token: string } }).message.token).toBe("tok");
  });

  it("reuses the cached access token for later sends", async () => {
    fetchMock
      .mockResolvedValueOnce(accessTokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, {}))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    await sendFcmMessage("row-1", "tok-1", { title: "T", body: "B" });
    await sendFcmMessage("row-2", "tok-2", { title: "T", body: "B" });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([TOKEN_URL, SEND_URL, SEND_URL]);
  });

  it("shares one access-token fetch between concurrent sends", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url === TOKEN_URL ? accessTokenResponse() : jsonResponse(200, {})),
    );

    await Promise.all([
      sendFcmMessage("row-1", "tok-1", { title: "T", body: "B" }),
      sendFcmMessage("row-2", "tok-2", { title: "T", body: "B" }),
    ]);

    expect(fetchMock.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(1);
  });

  it("reports an unregistered token as stale for the caller to prune", async () => {
    fetchMock
      .mockResolvedValueOnce(accessTokenResponse())
      .mockResolvedValueOnce(
        jsonResponse(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }),
      );

    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("stale");
  });

  it("drops the cached access token after a 401 so the next send fetches a fresh one", async () => {
    fetchMock
      .mockResolvedValueOnce(accessTokenResponse())
      .mockResolvedValueOnce(jsonResponse(401, { error: { status: "UNAUTHENTICATED" } }))
      .mockResolvedValueOnce(accessTokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, {}));

    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("failed");
    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("sent");
    expect(fetchMock.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(2);
  });

  it("fails without throwing when the access token cannot be had", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "invalid_grant" }));

    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails without caching anything when the token endpoint answers 200 with no access_token", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token_type: "Bearer" }))
      .mockResolvedValueOnce(accessTokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, {}));

    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("failed");
    // The malformed answer was not cached: the next send asks again, then sends.
    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("sent");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([TOKEN_URL, TOKEN_URL, SEND_URL]);
  });

  it("fails without throwing when the token endpoint's error body cannot be read", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("stream aborted")),
    });

    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an access token with no expires_in as good for the default hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-12T08:00:00Z"));
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(url === TOKEN_URL ? jsonResponse(200, { access_token: "ya29.access" }) : jsonResponse(200, {})),
      );

      await sendFcmMessage("row-1", "tok", { title: "T", body: "B" });
      vi.setSystemTime(new Date("2026-11-12T08:50:00Z"));
      await sendFcmMessage("row-1", "tok", { title: "T", body: "B" });
      expect(fetchMock.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(1);

      vi.setSystemTime(new Date("2026-11-12T09:00:00Z"));
      await sendFcmMessage("row-1", "tok", { title: "T", body: "B" });
      expect(fetchMock.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a rejection with an unreadable body as failed, not stale, and keeps the access token", async () => {
    fetchMock
      .mockResolvedValueOnce(accessTokenResponse())
      .mockResolvedValueOnce(new Response("<html>Bad Gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("failed");
    // Only a 401 drops the cached token; a 502 is FCM's problem, not the token's.
    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("sent");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([TOKEN_URL, SEND_URL, SEND_URL]);
  });

  it("fails without throwing when the send itself errors", async () => {
    fetchMock.mockResolvedValueOnce(accessTokenResponse()).mockRejectedValueOnce(new Error("socket hang up"));

    expect(await sendFcmMessage("row-1", "tok", { title: "T", body: "B" })).toBe("failed");
  });
});
