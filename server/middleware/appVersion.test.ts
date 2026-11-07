import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted((): { MIN_APP_VERSION_ANDROID?: string; MIN_APP_VERSION_IOS?: string } => ({}));
vi.mock("../env", () => ({ env: mockEnv }));

import { appVersionGate, compareAppVersions, parseAppVersion, readAppClient } from "./appVersion";

function buildApp() {
  const app = express();
  app.use("/api/v1", appVersionGate);
  app.get("/api/v1/thing", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("appVersionGate", () => {
  beforeEach(() => {
    delete mockEnv.MIN_APP_VERSION_ANDROID;
    delete mockEnv.MIN_APP_VERSION_IOS;
  });

  it("passes web requests, which send no platform header, even with a minimum set", async () => {
    mockEnv.MIN_APP_VERSION_ANDROID = "2.0.0";

    const res = await request(buildApp()).get("/api/v1/thing");

    expect(res.status).toBe(200);
  });

  it("serves every build while no minimum is configured", async () => {
    const res = await request(buildApp())
      .get("/api/v1/thing")
      .set("X-App-Platform", "android")
      .set("X-App-Version", "0.0.1");

    expect(res.status).toBe(200);
  });

  it("refuses a build older than the platform's minimum with 426 APP_UPDATE_REQUIRED", async () => {
    mockEnv.MIN_APP_VERSION_ANDROID = "1.4.0";

    const res = await request(buildApp())
      .get("/api/v1/thing")
      .set("X-App-Platform", "android")
      .set("X-App-Version", "1.3.9");

    expect(res.status).toBe(426);
    expect(res.body).toMatchObject({ code: "APP_UPDATE_REQUIRED", minimumVersion: "1.4.0" });
  });

  it.each(["1.4.0", "1.4.1", "1.10.0", "2.0.0"])("serves version %s against a 1.4.0 minimum", async (version) => {
    mockEnv.MIN_APP_VERSION_ANDROID = "1.4.0";

    const res = await request(buildApp())
      .get("/api/v1/thing")
      .set("X-App-Platform", "android")
      .set("X-App-Version", version);

    expect(res.status).toBe(200);
  });

  it("applies each platform's own minimum", async () => {
    mockEnv.MIN_APP_VERSION_IOS = "3.0.0";

    const android = await request(buildApp())
      .get("/api/v1/thing")
      .set("X-App-Platform", "android")
      .set("X-App-Version", "1.0.0");
    const ios = await request(buildApp())
      .get("/api/v1/thing")
      .set("X-App-Platform", "ios")
      .set("X-App-Version", "2.9.9");

    expect(android.status).toBe(200);
    expect(ios.status).toBe(426);
  });

  it.each([undefined, "", "1.4", "v1.4.0", "1.4.0-beta", "latest"])(
    "refuses a missing or malformed version (%s) once a minimum is set",
    async (version) => {
      mockEnv.MIN_APP_VERSION_ANDROID = "1.0.0";
      const req = request(buildApp()).get("/api/v1/thing").set("X-App-Platform", "android");

      const res = await (version === undefined ? req : req.set("X-App-Version", version));

      expect(res.status).toBe(426);
    },
  );

  it("matches the platform header case-insensitively", async () => {
    mockEnv.MIN_APP_VERSION_ANDROID = "1.4.0";

    const res = await request(buildApp())
      .get("/api/v1/thing")
      .set("X-App-Platform", " Android ")
      .set("X-App-Version", "1.0.0");

    expect(res.status).toBe(426);
  });

  it("ignores an unrecognised platform", async () => {
    mockEnv.MIN_APP_VERSION_ANDROID = "9.0.0";
    mockEnv.MIN_APP_VERSION_IOS = "9.0.0";

    const res = await request(buildApp())
      .get("/api/v1/thing")
      .set("X-App-Platform", "windows")
      .set("X-App-Version", "1.0.0");

    expect(res.status).toBe(200);
  });
});

describe("readAppClient", () => {
  const req = (headers: Record<string, string>) => ({ headers });

  it("returns null without a platform header", () => {
    expect(readAppClient(req({ "x-app-version": "1.0.0" }))).toBeNull();
  });

  it("drops a malformed version so nothing raw reaches the access log", () => {
    expect(readAppClient(req({ "x-app-platform": "ios", "x-app-version": "1.0.0\n{\"forged\":1}" }))).toEqual({
      platform: "ios",
      version: null,
    });
  });

  it("returns the trimmed, validated version", () => {
    expect(readAppClient(req({ "x-app-platform": "android", "x-app-version": " 1.2.3 " }))).toEqual({
      platform: "android",
      version: "1.2.3",
    });
  });
});

describe("version parsing and comparison", () => {
  it("compares numerically, not as strings", () => {
    expect(compareAppVersions(parseAppVersion("1.10.0")!, parseAppVersion("1.9.9")!)).toBeGreaterThan(0);
    expect(compareAppVersions(parseAppVersion("1.2.3")!, parseAppVersion("1.2.3")!)).toBe(0);
    expect(compareAppVersions(parseAppVersion("0.9.0")!, parseAppVersion("1.0.0")!)).toBeLessThan(0);
  });

  it("rejects anything but three numeric parts", () => {
    expect(parseAppVersion("1.2")).toBeNull();
    expect(parseAppVersion("1.2.3.4")).toBeNull();
    expect(parseAppVersion("a.b.c")).toBeNull();
  });
});
