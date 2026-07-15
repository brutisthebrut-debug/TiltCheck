import type { Request } from "express";
import { and, eq, getTableColumns } from "drizzle-orm";
import { db, usersTable, crewMembersTable } from "@workspace/db";
import { isDemoRequest } from "../middlewares/demo";
import { resolveActiveCrewId } from "./crews";

/**
 * World-scoping for user queries: real sessions only ever see real users,
 * demo sessions only ever see the fictional demo crew. Apply this condition
 * to every query that lists users or joins through them.
 */
export function userScopeCondition(req: Request) {
  return eq(usersTable.isDemo, isDemoRequest(req));
}

/**
 * Guard for endpoints that accept an explicit target userId: the target must
 * exist in the request's world (demo requests can't read real bettors' data,
 * and real views never surface demo profiles). Returns false when the user is
 * missing or belongs to the other world — treat as "not found".
 */
/**
 * The users whose results the request's social surfaces (leaderboard,
 * head-to-head, weekly recap highlights, workspace member list) may show:
 *
 * - Demo requests: the whole fictional demo world (one sealed crew).
 * - Real requests: the members of the viewer's active crew, double-scoped to
 *   isDemo=false so a demo bettor can never leak in even through a corrupt
 *   membership row. Crewless viewers see only themselves; profile-less
 *   sessions see nobody.
 */
export async function getSocialUsers(req: Request): Promise<(typeof usersTable.$inferSelect)[]> {
  if (isDemoRequest(req)) {
    return db.select().from(usersTable).where(eq(usersTable.isDemo, true)).orderBy(usersTable.id);
  }
  const me = req.currentUser;
  if (!me) return [];
  const crewId = await resolveActiveCrewId(me);
  if (crewId == null) {
    return db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, me.id), eq(usersTable.isDemo, false)));
  }
  return db
    .select(getTableColumns(usersTable))
    .from(crewMembersTable)
    .innerJoin(usersTable, eq(crewMembersTable.userId, usersTable.id))
    .where(and(eq(crewMembersTable.crewId, crewId), eq(usersTable.isDemo, false)))
    .orderBy(usersTable.id);
}

/**
 * Crew-aware authorization for social lookups: is this target user someone
 * the requester's social surfaces may show? True only when the target sits in
 * the requester's active crew (or is the requester themselves; demo requests
 * cover the demo world). Stricter than userInScope, which only separates the
 * demo and real worlds — use THIS for anything that exposes another bettor's
 * results by userId.
 */
export async function userInSocialScope(req: Request, userId: number): Promise<boolean> {
  const users = await getSocialUsers(req);
  return users.some((u) => u.id === userId);
}

export async function userInScope(req: Request, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ isDemo: usersTable.isDemo })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row != null && row.isDemo === isDemoRequest(req);
}
