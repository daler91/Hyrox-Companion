import { glob, rm, stat } from "node:fs/promises";

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

/**
 * Delete any .map files left in the deployed output.
 *
 * Both Sentry plugins remove their own sourcemaps via
 * `filesToDeleteAfterUpload`, but only when an upload actually happens —
 * `disable: !sentryAuthToken` means a build without SENTRY_AUTH_TOKEN (any
 * contributor build, and any deploy where the token was not configured) leaves
 * `dist/public/assets/*.map` behind, where `express.static` then serves them at
 * /assets/*.map with a one-year immutable cache. `build.sourcemap: "hidden"`
 * omits the `//# sourceMappingURL` comment but still writes the files.
 *
 * Sweeping unconditionally after the build makes the outcome independent of
 * whether the upload ran. Anything uploaded to Sentry has already been sent by
 * this point, so this never costs us a symbolicated stack trace.
 */
async function deleteStraySourcemaps(): Promise<void> {
  const stray: string[] = [];
  for await (const file of glob("dist/**/*.map")) {
    stray.push(file);
  }
  await Promise.all(stray.map((file) => rm(file, { force: true })));
  console.log(
    stray.length > 0
      ? `removed ${stray.length} sourcemap(s) from dist/ so they are not served to clients`
      : "no sourcemaps left in dist/",
  );
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

  await deleteStraySourcemaps();

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
