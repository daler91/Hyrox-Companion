import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The built client that serveStatic serves. Fixed when the module loads and
 * never taken from a caller, so nothing a request or an argument carries can
 * point it at another directory. The bundle places this module in
 * dist/index.js, next to dist/public. Its own module so a test can mock it
 * with a fixture build.
 */
export const STATIC_DIST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);
