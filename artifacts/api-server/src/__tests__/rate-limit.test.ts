/**
 * Rate limiting. Proves:
 *  - over-budget requests get 429 with the friendly app-voice message
 *  - budgets are per client key: signed-in traffic counts per Clerk account,
 *    anonymous traffic per first X-Forwarded-For hop
 *  - separate limiters have separate budgets (tight one trips, general no)
 *  - under NODE_ENV=test the app's real limiters are skipped (the suite
 *    itself would trip them otherwise)
 *
 * No DB access — limiters are exercised on tiny local express apps.
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: async () => ({}) } },
}));

import { makeLimiter, RATE_LIMIT_MESSAGE } from "../middlewares/rate-limit";

function appWith(limiter: express.RequestHandler) {
  const app = express();
  // Mirror the real app: exactly one trusted proxy hop, so req.ip is the
  // address that hop appended to X-Forwarded-For.
  app.set("trust proxy", 1);
  app.use(limiter);
  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("rate limiting", () => {
  it("returns 429 with the friendly message once the budget is spent", async () => {
    const app = appWith(makeLimiter({ windowMs: 60_000, limit: 3, enforceAlways: true }));
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get("/ping")).status).toBe(200);
    }
    const blocked = await request(app).get("/ping");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(RATE_LIMIT_MESSAGE);
    expect(blocked.headers["ratelimit"]).toBeDefined();
  });

  it("keys signed-in traffic per account — one account's burst doesn't block another", async () => {
    const app = appWith(makeLimiter({ windowMs: 60_000, limit: 2, enforceAlways: true }));
    await request(app).get("/ping").set("x-test-user", "user_a");
    await request(app).get("/ping").set("x-test-user", "user_a");
    expect((await request(app).get("/ping").set("x-test-user", "user_a")).status).toBe(429);
    expect((await request(app).get("/ping").set("x-test-user", "user_b")).status).toBe(200);
  });

  it("keys anonymous traffic per proxy-appended client IP; a spoofed prefix can't mint fresh keys", async () => {
    const app = appWith(makeLimiter({ windowMs: 60_000, limit: 2, enforceAlways: true }));
    // The trusted hop appended 203.0.113.7 (last entry). The client-supplied
    // prefix varies every request — it must be ignored.
    await request(app).get("/ping").set("x-forwarded-for", "1.1.1.1, 203.0.113.7");
    await request(app).get("/ping").set("x-forwarded-for", "2.2.2.2, 203.0.113.7");
    expect(
      (await request(app).get("/ping").set("x-forwarded-for", "3.3.3.3, 203.0.113.7")).status,
    ).toBe(429);
    // A genuinely different client (different proxy-appended address) is a
    // separate budget.
    expect(
      (await request(app).get("/ping").set("x-forwarded-for", "198.51.100.9")).status,
    ).toBe(200);
  });

  it("limiters are independent — spending a tight budget leaves the general one intact", async () => {
    const tight = makeLimiter({ windowMs: 60_000, limit: 1, enforceAlways: true });
    const general = makeLimiter({ windowMs: 60_000, limit: 100, enforceAlways: true });
    const app = express();
    app.use(general);
    app.get("/expensive", tight, (_req, res) => {
      res.json({ ok: true });
    });
    app.get("/cheap", (_req, res) => {
      res.json({ ok: true });
    });

    expect((await request(app).get("/expensive")).status).toBe(200);
    expect((await request(app).get("/expensive")).status).toBe(429);
    expect((await request(app).get("/cheap")).status).toBe(200);
  });

  it("is dormant under the test env unless explicitly enforced", async () => {
    const app = appWith(makeLimiter({ windowMs: 60_000, limit: 1 }));
    for (let i = 0; i < 5; i++) {
      expect((await request(app).get("/ping")).status).toBe(200);
    }
  });
});
