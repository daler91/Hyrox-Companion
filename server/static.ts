import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
import rateLimit from "express-rate-limit";
import { RATE_LIMIT_WINDOW_15M_MS } from "./constants";

const currentFilename = fileURLToPath(import.meta.url);
const currentDirname = path.dirname(currentFilename);

export function serveStatic(app: Express) {
  const distPath = path.resolve(currentDirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      maxAge: "1y",
      immutable: true,
    }),
  );

  app.use(express.static(distPath, { maxAge: 0, index: false }));

  // Read HTML once at startup — inject per-request nonce for CSP
  const indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");

  const fallbackLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_15M_MS,
    max: 100,
  });

  app.use("*", fallbackLimiter, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    const nonce = res.locals.cspNonce;
    const html = indexHtml.replace(/<script /g, `<script nonce="${nonce}" `);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });
}
