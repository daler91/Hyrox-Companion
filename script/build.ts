import { rm, stat } from "node:fs/promises";

import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

// Catastrophic build regressions (vite plugin crash, esbuild emitting empty
// output) currently slip past `pnpm run build` and only surface at production
// startup. Floors are deliberately well below today's sizes (server ~444 KB,
// index.html ~4 KB) so they catch zero-byte / truncated output without
// flapping on legitimate size shrinks (S20).
const BUILD_ARTIFACT_FLOORS: { path: string; minBytes: number }[] = [
  { path: "dist/index.js", minBytes: 50_000 },
  { path: "dist/public/index.html", minBytes: 200 },
];

async function assertBuildArtifacts(): Promise<void> {
  for (const { path, minBytes } of BUILD_ARTIFACT_FLOORS) {
    const { size } = await stat(path);
    if (size < minBytes) {
      throw new Error(
        `build artifact ${path} is suspiciously small (${size} bytes < ${minBytes}); likely a silent build failure`,
      );
    }
  }
}

try {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: "dist/index.js",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    sourcemap: true,
    packages: "external",
    logLevel: "info",
    plugins: [
      sentryEsbuildPlugin({
        authToken: sentryAuthToken,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT_SERVER,
        telemetry: false,
        disable: !sentryAuthToken,
        sourcemaps: {
          filesToDeleteAfterUpload: ["./dist/index.js.map"],
        },
      }),
    ],
  });

  await assertBuildArtifacts();
  console.log("build artifacts verified");

  // Structural bundle invariants (charts off the critical path, no drizzle in
  // the browser). Run in-process (no PATH-resolved subprocess) and non-fatally
  // — a chunking regression shouldn't block a deploy — but loud;
  // `pnpm check:bundle` runs the same checks as a hard fail.
  const { collectBundleCheckFailures } = await import("./bundle-check");
  const bundleFailures = await collectBundleCheckFailures().catch((err: unknown) => [
    `bundle-check crashed: ${String(err)}`,
  ]);
  if (bundleFailures.length > 0) {
    console.warn(
      `WARNING (non-fatal): bundle-check failed — client chunking regressed; run \`pnpm check:bundle\` for details:\n  - ${bundleFailures.join("\n  - ")}`,
    );
  } else {
    console.log("bundle-check passed");
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
