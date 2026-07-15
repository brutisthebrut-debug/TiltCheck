import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { isDemoRequest } from "../middlewares/demo";

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
export async function userInScope(req: Request, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ isDemo: usersTable.isDemo })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row != null && row.isDemo === isDemoRequest(req);
}
