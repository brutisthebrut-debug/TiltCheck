import { Router, type IRouter } from "express";
import { eq, desc, sum, and, inArray } from "drizzle-orm";
import { db, transactionsTable, usersTable, betsTable, parlaysTable } from "@workspace/db";
import {
  GetBankrollQueryParams,
  ListTransactionsQueryParams,
  CreateTransactionBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getUserBankroll(userId: number) {
  const user = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user[0]) return null;

  const startingBalance = Number(user[0].startingBankroll);

  const txRows = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, userId))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(1);

  const currentBalance = txRows.length > 0 ? Number(txRows[0].balanceAfter) : startingBalance;

  // Sum deposits and withdrawals
  const depositRows = await db
    .select({ total: sum(transactionsTable.amount) })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.type, "deposit")));

  const withdrawRows = await db
    .select({ total: sum(transactionsTable.amount) })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.type, "withdraw")));

  const totalDeposited = Number(depositRows[0]?.total ?? 0);
  const totalWithdrawn = Math.abs(Number(withdrawRows[0]?.total ?? 0));
  const netProfitLoss = currentBalance - startingBalance - totalDeposited + totalWithdrawn;
  const totalWagered = await getTotalWagered(userId);
  const roi = totalWagered > 0 ? (netProfitLoss / totalWagered) * 100 : 0;

  return {
    userId,
    currentBalance,
    startingBalance,
    totalDeposited,
    totalWithdrawn,
    netProfitLoss,
    roi: Math.round(roi * 100) / 100,
  };
}

async function getTotalWagered(userId: number): Promise<number> {
  const betRows = await db
    .select({ total: sum(betsTable.stake) })
    .from(betsTable)
    .where(and(eq(betsTable.userId, userId), inArray(betsTable.status, ["won", "lost", "push"])));
  const parlayRows = await db
    .select({ total: sum(parlaysTable.stake) })
    .from(parlaysTable)
    .where(
      and(eq(parlaysTable.userId, userId), inArray(parlaysTable.status, ["won", "lost", "push"])),
    );
  return Number(betRows[0]?.total ?? 0) + Number(parlayRows[0]?.total ?? 0);
}

// GET /bankroll
router.get("/bankroll", async (req, res): Promise<void> => {
  const query = GetBankrollQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const userId = query.data.userId;
  if (userId == null) {
    // Return first user's bankroll
    const [firstUser] = await db.select().from(usersTable).orderBy(usersTable.id).limit(1);
    if (!firstUser) {
      res.status(404).json({ error: "No users found" });
      return;
    }
    const bankroll = await getUserBankroll(firstUser.id);
    if (!bankroll) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(bankroll);
    return;
  }
  const bankroll = await getUserBankroll(userId);
  if (!bankroll) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(bankroll);
});

// GET /bankroll/transactions
router.get("/bankroll/transactions", async (req, res): Promise<void> => {
  const query = ListTransactionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { userId, limit } = query.data;
  const conditions = [];
  if (userId != null) conditions.push(eq(transactionsTable.userId, userId));

  const rows = await db
    .select()
    .from(transactionsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit ?? 20);

  res.json(rows.map((t) => ({
    id: t.id,
    userId: t.userId,
    type: t.type,
    amount: Number(t.amount),
    balanceAfter: Number(t.balanceAfter),
    note: t.note ?? null,
    referenceId: t.referenceId ?? null,
    referenceType: t.referenceType ?? null,
    createdAt: t.createdAt.toISOString(),
  })));
});

// POST /bankroll/transactions
router.post("/bankroll/transactions", async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId, type, amount, note } = parsed.data;
  const bankroll = await getUserBankroll(userId);
  if (!bankroll) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const signedAmount = type === "withdraw" ? -Math.abs(Number(amount)) : Number(amount);
  const newBalance = bankroll.currentBalance + signedAmount;

  const [tx] = await db
    .insert(transactionsTable)
    .values({
      userId,
      type,
      amount: String(signedAmount.toFixed(2)),
      balanceAfter: String(newBalance.toFixed(2)),
      note: note ?? null,
    })
    .returning();

  res.status(201).json({
    id: tx.id,
    userId: tx.userId,
    type: tx.type,
    amount: Number(tx.amount),
    balanceAfter: Number(tx.balanceAfter),
    note: tx.note ?? null,
    referenceId: tx.referenceId ?? null,
    referenceType: tx.referenceType ?? null,
    createdAt: tx.createdAt.toISOString(),
  });
});

export default router;
