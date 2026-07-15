import type { Request, Response, NextFunction } from "express";
import { eq, asc } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** True when this request came in through the public /api/demo mount. */
      isDemoRequest?: boolean;
    }
  }
}

/** True when the request is serving the public demo board. */
export function isDemoRequest(req: Request): boolean {
  return req.isDemoRequest === true;
}

export const DEMO_READ_ONLY_MESSAGE =
  "The demo board is read-only — sign up to log your own bets.";

/**
 * Hard read-only gate for the demo mount: any request that could write is
 * rejected before it reaches a route handler. GET/HEAD/OPTIONS only.
 */
export function demoReadOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.status(403).json({ error: "demo_read_only", message: DEMO_READ_ONLY_MESSAGE });
    return;
  }
  next();
}

/**
 * Public demo session: no sign-in required. The viewer browses the board as
 * the demo crew's point-of-view member (lowest id among demo users), so every
 * "me"-scoped endpoint (dashboard, bankroll, recap, needs-settling) works
 * exactly like the real product.
 */
export async function demoSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const [pov] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.isDemo, true))
    .orderBy(asc(usersTable.id))
    .limit(1);
  if (!pov) {
    res.status(503).json({ error: "demo_unavailable", message: "The demo board isn't seeded yet." });
    return;
  }
  req.isDemoRequest = true;
  req.currentUser = pov;
  next();
}
