import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  CreateUserBody,
  CreateUserResponse,
  GetCurrentUserResponse,
  ListUsersResponse,
} from "@workspace/api-zod";
import * as z from "zod";

const router: IRouter = Router();

const UpdateUserBody = z.object({
  startingBankroll: z.number().positive().optional(),
  displayName: z.string().min(1).optional(),
  avatarColor: z.string().optional(),
});

// GET /users/me — return first user or create default
router.get("/users/me", async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.id).limit(1);
  if (users.length === 0) {
    const [user] = await db
      .insert(usersTable)
      .values({ username: "player1", displayName: "Player One", avatarColor: "#6366f1", startingBankroll: "1000" })
      .returning();
    res.json(GetCurrentUserResponse.parse(formatUser(user)));
    return;
  }
  res.json(GetCurrentUserResponse.parse(formatUser(users[0])));
});

// GET /users
router.get("/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.id);
  res.json(ListUsersResponse.parse(users.map(formatUser)));
});

// POST /users
router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, displayName, avatarColor, startingBankroll } = parsed.data;
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      displayName,
      avatarColor: avatarColor ?? "#6366f1",
      startingBankroll: String(startingBankroll),
    })
    .returning();
  res.status(201).json(CreateUserResponse.parse(formatUser(user)));
});

// PATCH /users/:id — update startingBankroll and/or display name
router.patch("/users/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { startingBankroll, displayName, avatarColor } = parsed.data;
  const updateValues: Record<string, unknown> = {};
  if (startingBankroll !== undefined) updateValues.startingBankroll = String(startingBankroll);
  if (displayName !== undefined) updateValues.displayName = displayName;
  if (avatarColor !== undefined) updateValues.avatarColor = avatarColor;

  if (Object.keys(updateValues).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updateValues)
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(updated));
});

function formatUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    startingBankroll: Number(u.startingBankroll),
    createdAt: u.createdAt.toISOString(),
  };
}

export default router;
