import type { Request, Response, Router } from "express";

import { RATE_LIMIT_WINDOW_15M_MS } from "../constants";
import { getAppUrl, verifyUnsubscribeToken } from "../emailUnsubscribeToken";
import { logger } from "../logger";
import { asyncHandler, rateLimiter } from "../routeUtils";
import { storage } from "../storage";

/**
 * Login-free email unsubscribe, reached from the footer link and from the
 * `List-Unsubscribe` header of every email (server/emailUnsubscribeToken.ts).
 *
 * GET only *shows* a confirm page: link-scanning mail security products fetch
 * every URL in an email, and a GET that unsubscribed would have them opting
 * athletes out silently. POST does the work — mail clients send an RFC 8058
 * one-click POST straight to the header URL, and the confirm page's form posts
 * to the same URL. Neither request carries a cookie or CSRF token, which is why
 * these routes mount ahead of the /api/v1 CSRF guard (server/routes.ts). The
 * signed token is the whole authorisation; the pages never echo user data.
 */

const UNSUBSCRIBE_PATH = "/api/v1/emails/unsubscribe";
const unsubscribeLimiter = rateLimiter("emailUnsubscribe", 60, RATE_LIMIT_WINDOW_15M_MS);

function page(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — fitai.coach</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f4f5; margin: 0; padding: 32px 16px; color: #0f172a; }
  .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px 24px; text-align: center; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { color: #475569; font-size: 15px; line-height: 1.5; }
  .button { display: inline-block; background: #0f172a; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; border: 0; font-size: 15px; cursor: pointer; margin-top: 8px; }
  a.link { color: #64748b; }
</style></head>
<body><div class="card">${bodyHtml}</div></body></html>`;
}

function invalidLinkPage(): string {
  return page(
    "Link no longer valid",
    `<h1>This link is no longer valid</h1>
<p>You can still turn email off from your account settings.</p>
<p><a class="link" href="${getAppUrl()}/settings">Open email preferences</a></p>`,
  );
}

function confirmPage(token: string): string {
  const action = `${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
  return page(
    "Unsubscribe",
    `<h1>Unsubscribe from fitai.coach email?</h1>
<p>This turns off every training email. You can switch individual emails back on at any time from Settings.</p>
<form method="post" action="${action}"><button class="button" type="submit">Unsubscribe</button></form>
<p><a class="link" href="${getAppUrl()}/settings">Manage preferences instead</a></p>`,
  );
}

function unsubscribedPage(): string {
  return page(
    "Unsubscribed",
    `<h1>You're unsubscribed</h1>
<p>No more training emails will be sent to this address.</p>
<p><a class="link" href="${getAppUrl()}/settings">Change your mind in Settings</a></p>`,
  );
}

function sendHtml(res: Response, status: number, html: string): void {
  res.status(status).type("html").send(html);
}

function tokenFrom(req: Request): string | null {
  // A type check on the query parameter; the token's value is only ever
  // compared in constant time inside verifyUnsubscribeToken.
  // bearer:disable javascript_lang_observable_timing
  return typeof req.query.token === "string" ? req.query.token : null;
}

async function handleUnsubscribe(req: Request, res: Response): Promise<void> {
  const verified = verifyUnsubscribeToken(tokenFrom(req));
  if (!verified) {
    sendHtml(res, 400, invalidLinkPage());
    return;
  }
  const changed = await storage.users.disableEmailNotifications(verified.userId);
  if (!changed) {
    // The account is gone. Nothing to do, and the mail client expects a 2xx.
    sendHtml(res, 200, invalidLinkPage());
    return;
  }
  // A static message and an opaque id; no address or content is logged.
  // bearer:disable javascript_lang_logger_leak
  logger.info({ context: "email", userId: verified.userId }, "Email notifications disabled via unsubscribe link");
  sendHtml(res, 200, unsubscribedPage());
}

/**
 * Mounted BEFORE the /api/v1 CSRF guard (server/routes.ts): mail clients POST
 * here with neither cookie nor token, and GET must stay side-effect free.
 */
export function registerEmailUnsubscribeRoutes(router: Router): void {
  router.get(UNSUBSCRIBE_PATH, unsubscribeLimiter, (req: Request, res: Response) => {
    const token = tokenFrom(req);
    if (token === null || !verifyUnsubscribeToken(token)) {
      sendHtml(res, 400, invalidLinkPage());
      return;
    }
    sendHtml(res, 200, confirmPage(token));
  });
  router.post(UNSUBSCRIBE_PATH, unsubscribeLimiter, asyncHandler(handleUnsubscribe));
}
