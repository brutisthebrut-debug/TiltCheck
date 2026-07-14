import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  CreateUserBody,
  CreateUserResponse,
  GetCurrentUserResponse,
  ListUsersResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /users/me — return first user or create default
router.get("/users/me", async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.id).limit(1);
  if (users.length === 0) {
    // Create a default user on first visit
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
