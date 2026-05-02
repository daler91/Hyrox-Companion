import type { Server } from "node:http";

import { logger } from "../logger";

export function registerLifecycleHooks(server: Server): void {
  server.on("close", () => {
    logger.info({ context: "lifecycle" }, "HTTP server closed");
  });
}
