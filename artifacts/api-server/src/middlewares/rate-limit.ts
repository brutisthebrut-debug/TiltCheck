import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request } from "express";
import { getAuth } from "@clerk/express";

/**
 * Rate limiting, in three route classes:
 *
 *  - auth: profile claim/creation — hits Clerk's backend API and writes
 *    accounts, so it gets the tightest budget.
 *  - narrative: the AI recap narrative — each cold call is a paid model
 *    invocation (cache + singleflight soften repeats, but the budget caps
 *    what a hostile client can force).
 *  - general: everything else under /api, sized so no real bettor (or demo
 *    visitor paging through the board) ever sees it, while a runaway script
 *    gets stopped.
 *
 * Keying: signed-in traffic is throttled per Clerk account, anonymous
 * traffic (demo board, unauthenticated probes) per client IP. req.ip is the
 * trustworthy source here: app.ts sets `trust proxy` to exactly the one
 * Replit proxy hop, so req.ip is the address the proxy appended, and a
 * client-forged X-Forwarded-For prefix can neither rotate keys nor inflate
 * the in-memory key space.
 *
 * The whole test suite shares one key, so limits are skipped under
 * NODE_ENV=test; limiter behavior itself is tested by constructing limiters
 * with `enforceAlways`.
 */

/**
 * One message for every limiter — the app's voice, no tech jargon. `error`
 * carries the human-readable text because that's the field the frontend's
 * error helper surfaces (same convention as every other API error).
 */
export const RATE_LIMIT_MESSAGE = {
  error: "Whoa — that's tilt-speed clicking. Take a breath and try again in a minute.",
  code: "rate_limited",
} as const;

function clientKey(req: Request): string {
  let clerkUserId: string | null | undefined;
  try {
    clerkUserId = getAuth(req)?.userId;
  } catch {
    // clerkMiddleware hasn't run for this request (shouldn't happen under
    // /api, but a keying fallback must never throw).
  }
  if (clerkUserId) return `user:${clerkUserId}`;
  // ipKeyGenerator normalizes IPv6 clients to their /56 so one visitor can't
  // mint fresh keys from a huge v6 allocation.
  return req.ip ? `ip:${ipKeyGenerator(req.ip)}` : "ip:unknown";
}

type LimiterOptions = {
  windowMs: number;
  limit: number;
  /** Test hook: enforce even under NODE_ENV=test. */
  enforceAlways?: boolean;
};

export function makeLimiter({ windowMs, limit, enforceAlways = false }: LimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: clientKey,
    skip: () => !enforceAlways && process.env.NODE_ENV === "test",
    handler: (_req, res) => {
      res.status(429).json(RATE_LIMIT_MESSAGE);
    },
  });
}

/** Profile claim & account creation: 20 attempts / 15 min per client. */
export const authLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 20 });

/** AI recap narrative: 10 requests / 5 min per client. */
export const narrativeLimiter = makeLimiter({ windowMs: 5 * 60 * 1000, limit: 10 });

/** Everything else under /api: 300 requests / min per client. */
export const generalLimiter = makeLimiter({ windowMs: 60 * 1000, limit: 300 });
