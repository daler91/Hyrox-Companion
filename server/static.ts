import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express } from "express";

import { RATE_LIMIT_WINDOW_15M_MS } from "./constants";
import { rateLimiter, sendNotFound } from "./routeUtils";

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

  // The SPA shell below is for client-side routes only. Answered with
  // index.html and a 200, a missing chunk (a tab on the previous build asking
  // for an old hash) failed as a MIME error rather than a chunk 404, and an
  // unmatched /api path looked like success: the offline queue treats any 2xx
  // as synced, so a mutation queued against a route a later deploy renamed was
  // reported as synced and dropped. C38 (CODEBASE_ANALYSIS_2026-10-03)
  app.use("/assets", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).type("text/plain").send("Not found");
  });

  app.use(express.static(distPath, { maxAge: 0, index: false }));

  app.use("/api", (_req, res) => {
    sendNotFound(res, "API route not found");
  });

  // Read HTML once at startup — inject per-request nonce for CSP
  const indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");

  // W14: Postgres-backed so the limit holds across instances (the previous
  // in-memory store let a client hit 100×N requests before any single instance
  // blocked). The "staticFallback" category keys by IP and fails open on GET,
  // so a transient DB blip can't stop the SPA shell from serving.
  const fallbackLimiter = rateLimiter("staticFallback", 100, RATE_LIMIT_WINDOW_15M_MS);

  app.use("/{*splat}", fallbackLimiter, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    const nonce = res.locals.cspNonce;
    const html = indexHtml.replaceAll("<script ", `<script nonce="${nonce}" `);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });
}
