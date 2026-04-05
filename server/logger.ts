import { env } from "./env";
import pino from "pino";
import { getRequestContext } from "./requestContext";

const isDev = env.NODE_ENV !== "production";

export const logger = pino({
  level: env.LOG_LEVEL || "info",
  redact: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-cron-secret"],
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

export function getContextLogger() {
  const ctx = getRequestContext();
  if (ctx) {
    return logger.child({ requestId: ctx.requestId, userId: ctx.userId });
  }
  return logger;
}
