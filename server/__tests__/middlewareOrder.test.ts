// @vitest-environment node
import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The canonical middleware order (docs/adr-startup-pattern.md) is the
 * precondition the ADR names for ever changing it, and no test pinned it (tech
 * debt #70). This one boots the real server/index.ts with its I/O mocked out,
 * captures the Express app it hands to createServer, and reads the stack
 * Express will actually run, so a reordered `app.use` fails here.
 */

const boot = vi.hoisted(() => ({ app: undefined as Express | undefined }));

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  const fakeServer = {
    once: vi.fn(),
    removeListener: vi.fn(),
    on: vi.fn(),
    listen: vi.fn((_options: unknown, onListening: () => void) => onListening()),
  };
  return {
    ...actual,
    createServer: vi.fn((app: Express) => {
      boot.app = app;
      return fakeServer;
    }),
  };
});

// Everything after "listening" that does I/O. registerRoutes and serveStatic
// leave a named marker where their middleware would sit.
vi.mock("../db", () => ({ pool: { end: vi.fn(), query: vi.fn() } }));
vi.mock("../vectorDb", () => ({ isVectorDbSeparate: () => false, vectorPool: { end: vi.fn() } }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../maintenance", () => ({ runStartupMaintenance: vi.fn(), getVectorSchemaStatus: vi.fn() }));
vi.mock("../queue", () => ({ queue: { stop: vi.fn() }, startQueue: vi.fn() }));
vi.mock("../cron", () => ({ startCron: vi.fn(), stopCron: vi.fn() }));
vi.mock("../services/stravaAutoSync", () => ({ registerStravaAutoSyncWorker: vi.fn() }));
vi.mock("../services/sessionStreamSync", () => ({ registerSessionStreamWorker: vi.fn() }));
vi.mock("../sseRegistry", () => ({ drainSseStreams: vi.fn() }));
vi.mock("../ssrfGuard", () => ({ assertResolvedHostIsPublic: vi.fn() }));
vi.mock("../bootstrap/lifecycle", () => ({ registerShutdownHandlers: vi.fn() }));
vi.mock("../bootstrap/observability", () => ({
  configureObservability: vi.fn(),
  registerProcessErrorHandlers: vi.fn(),
}));
vi.mock("../routes", () => ({
  registerRoutes: vi.fn((_server: unknown, app: Express) => {
    app.use(function registeredRoutes(_req, _res, next) {
      next();
    });
  }),
}));
vi.mock("../static", () => ({
  serveStatic: vi.fn((app: Express) => {
    app.use(function staticFallback(_req, _res, next) {
      next();
    });
  }),
}));
vi.mock("../../shared/openapi", () => ({ generateOpenApiDocument: () => ({}) }));
vi.mock("swagger-ui-express", () => ({
  serve: [],
  setup: () =>
    function swaggerUi(_req: unknown, _res: unknown, next: () => void) {
      next();
    },
}));

interface StackLayer {
  readonly name: string;
  readonly route?: { readonly path: string };
  readonly handle: { readonly logger?: unknown };
}

type Matcher = (layer: StackLayer) => boolean;

const named =
  (name: string): Matcher =>
  (layer) =>
    layer.name === name;
const route =
  (path: string): Matcher =>
  (layer) =>
    layer.route?.path === path;

/** The ADR's steps, in order, as they appear in the app's stack. */
function canonicalSteps(production: boolean): Array<[string, Matcher]> {
  return [
    ["compression", named("compression")],
    ["health (liveness)", route("/api/v1/health/live")],
    ["health", route("/api/v1/health")],
    ["Digital Asset Links", route("/.well-known/assetlinks.json")],
    ["CORS", named("corsMiddleware")],
    ...(production ? ([["CSP nonce", named("cspNonceMiddleware")]] as Array<[string, Matcher]>) : []),
    ["helmet", named("helmetMiddleware")],
    ["Permissions-Policy", named("permissionsPolicy")],
    ["JSON body parser", named("jsonBodyParserUnlessLarge")],
    ["urlencoded body parser", named("urlencodedParser")],
    ["cookie-parser", named("cookieParser")],
    ["request logger (pino-http)", (layer) => layer.handle.logger !== undefined],
    ["request context", named("bindRequestContext")],
    ["registerRoutes()", named("registeredRoutes")],
    ...(production ? [] : ([["Swagger UI (development)", named("swaggerUi")]] as Array<[string, Matcher]>)),
    ["central error handler", named("globalErrorHandler")],
    ["Sentry error handler", named("sentryErrorMiddleware")],
    ["static fallback", named("staticFallback")],
  ];
}

async function bootStack(production: boolean): Promise<StackLayer[]> {
  if (production) {
    const { env } = await import("../env");
    vi.doMock("../env", () => ({
      env: { ...env, NODE_ENV: "production", ALLOW_DEV_AUTH_BYPASS: "false" },
    }));
  }
  await import("../index");
  const app = boot.app as unknown as { router: { stack: StackLayer[] } };
  return app.router.stack;
}

function positions(stack: StackLayer[], steps: Array<[string, Matcher]>): Array<[string, number]> {
  return steps.map(([label, match]) => [label, stack.findIndex(match)]);
}

describe("canonical middleware order (docs/adr-startup-pattern.md)", () => {
  beforeEach(() => {
    vi.resetModules();
    boot.app = undefined;
  });

  afterEach(() => {
    vi.doUnmock("../env");
  });

  it.each([
    ["development and test", false],
    ["production", true],
  ])("mounts every step in the ADR's order (%s)", async (_mode, production) => {
    const steps = canonicalSteps(production);
    const found = positions(await bootStack(production), steps);

    // Every step is mounted...
    expect(found.filter(([, index]) => index < 0).map(([label]) => label)).toEqual([]);
    // ...and in the canonical order.
    const ordered = [...found].sort(([, a], [, b]) => a - b).map(([label]) => label);
    expect(ordered).toEqual(steps.map(([label]) => label));
  });

  it("mounts the CSP nonce middleware only in production", async () => {
    const stack = await bootStack(false);
    expect(stack.some(named("cspNonceMiddleware"))).toBe(false);
  });
});
