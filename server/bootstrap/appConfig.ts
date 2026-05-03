import type { Express } from "express";

import { env } from "../env";

export function configureApp(app: Express): { isDev: boolean } {
  const isDev = env.NODE_ENV !== "production";

  let trustProxy: boolean | string | number = 1;
  if (env.TRUST_PROXY === "0") trustProxy = false;
  else if (env.TRUST_PROXY === "loopback") trustProxy = "loopback";

  app.set("trust proxy", trustProxy);
  app.disable("x-powered-by");

  return { isDev };
}
