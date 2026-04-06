import fs from "node:fs";
import { type Server } from "node:http";
import path from "node:path";

import { type Express } from "express";
import rateLimit from "express-rate-limit";
import { nanoid } from "nanoid";
import { createLogger,createServer as createViteServer } from "vite";

import viteConfig from "../vite.config";
import { RATE_LIMIT_WINDOW_15M_MS } from "./constants";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);


  const viteFallbackLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_15M_MS,
    max: 100,
  });

  app.use("*", viteFallbackLimiter, (req, res, next) => {
    (async () => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
    })().catch(next);
  });
}
