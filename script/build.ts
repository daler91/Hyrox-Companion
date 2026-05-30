import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { rm } from "node:fs/promises";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

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
} catch (err) {
  console.error(err);
  process.exit(1);
}
