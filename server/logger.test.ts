import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { LOG_REDACT_PATHS } from "./logger";

function captureLogger() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const testLogger = pino(
    { redact: LOG_REDACT_PATHS, serializers: { res: pino.stdSerializers.res } },
    sink,
  );
  return { testLogger, lines };
}

describe("logger redaction", () => {
  it("redacts the response Set-Cookie header but keeps statusCode (P12)", () => {
    const { testLogger, lines } = captureLogger();
    const fakeRes = {
      statusCode: 200,
      headersSent: true,
      getHeaders: () => ({
        "content-type": "application/json",
        "set-cookie": ["__Host-fitai.x-csrf=secret-token-value; Path=/; Secure"],
      }),
    };

    testLogger.info({ res: fakeRes }, "request completed");

    const entry = JSON.parse(lines[0]);
    expect(entry.res.statusCode).toBe(200);
    expect(entry.res.headers["content-type"]).toBe("application/json");
    expect(entry.res.headers["set-cookie"]).toBe("[Redacted]");
    expect(lines[0]).not.toContain("secret-token-value");
  });

  it("still redacts sensitive request headers", () => {
    const { testLogger, lines } = captureLogger();

    testLogger.info({ req: { headers: { cookie: "session=abc" } } }, "request");

    expect(JSON.parse(lines[0]).req.headers.cookie).toBe("[Redacted]");
  });
});
