import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { isConfiguredFounderEmail } from "../lib/founder";

export type LocalUser = typeof usersTable.$inferSelect;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clerkUserId?: string;
      currentUser?: LocalUser | null;
    }
  }
}

/**
 * Requires a signed-in Clerk session. Attaches `req.clerkUserId` and loads the
 * linked local bettor profile (if any) onto `req.currentUser`.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.clerkUserId = clerkUserId;
  let [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);

  // Founder self-heal: an account whose email matches FOUNDER_EMAIL is
  // promoted to founder even if it linked before the founder feature existed
  // (or before the env var was set). Deliberately promote-only: changing
  // FOUNDER_EMAIL later never demotes an existing founder — demotion is a
  // manual decision, not something a config edit should do silently.
  if (user && !user.isFounder && isConfiguredFounderEmail(user.email)) {
    const [promoted] = await db
      .update(usersTable)
      .set({ isFounder: true })
      .where(eq(usersTable.id, user.id))
      .returning();
    if (promoted) {
      user = promoted;
      console.info(`[founder] promoted user ${promoted.id} (${promoted.username}) via FOUNDER_EMAIL match`);
    }
  }

  req.currentUser = user ?? null;
  next();
}

/**
 * Requires that the signed-in account has a linked bettor profile.
 * Must run after requireAuth.
 */
export function requireProfile(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    res.status(403).json({ error: "No bettor profile linked to this account" });
    return;
  }
  next();
}
