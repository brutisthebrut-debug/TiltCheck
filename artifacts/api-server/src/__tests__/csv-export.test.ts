/**
 * Integration tests for the CSV export endpoints.
 *
 * Proves:
 *   - header rows are stable (spreadsheets are built on the column order)
 *   - commas, quotes, and newlines in free text are escaped per RFC 4180
 *   - parlays export one row per leg with the parlay id repeated
 *   - exports are scoped to the signed-in user
 *   - content-type / content-disposition headers make browsers download a file
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";

let currentClerkUserId: string | null = null;

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: currentClerkUserId }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      getUser: async () => ({
        primaryEmailAddress: null,
        emailAddresses: [],
        firstName: null,
        lastName: null,
      }),
    },
  },
}));

import app from "../app";
import {
  db,
  pool,
  usersTable,
  betsTable,
  parlaysTable,
  parlayLegsTable,
  transactionsTable,
} from "@workspace/db";
import { BET_CSV_HEADER, PARLAY_CSV_HEADER, TRANSACTION_CSV_HEADER } from "../routes/export";
import { csvField, toCsv } from "../lib/csv";

const createdUserIds: number[] = [];
let counter = 0;

async function createUser() {
  const username = `test_csv_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "CSV Tester",
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId,
    })
    .returning();
  createdUserIds.push(row.id);
  return { row, clerkUserId };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    const parlays = await db
      .select({ id: parlaysTable.id })
      .from(parlaysTable)
      .where(inArray(parlaysTable.userId, createdUserIds));
    if (parlays.length > 0) {
      await db
        .delete(parlayLegsTable)
        .where(inArray(parlayLegsTable.parlayId, parlays.map((p) => p.id)));
      await db.delete(parlaysTable).where(inArray(parlaysTable.userId, createdUserIds));
    }
    await db.delete(betsTable).where(inArray(betsTable.userId, createdUserIds));
    await db.delete(transactionsTable).where(inArray(transactionsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

/** Parse one CSV line respecting quoted fields (good enough for assertions). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

describe("csv helper", () => {
  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    expect(csvField('plain')).toBe("plain");
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField(null)).toBe("");
    expect(csvField(-42.5)).toBe("-42.5");
  });

  it("neutralizes formula-injection triggers in free text", () => {
    expect(csvField("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvField("+1234")).toBe("'+1234");
    expect(csvField("@cmd")).toBe("'@cmd");
    expect(csvField("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    // Leading whitespace must not defeat the guard.
    expect(csvField("  =HYPERLINK(...)")).toBe("'  =HYPERLINK(...)");
    // Negative numbers must NOT be quoted away.
    expect(csvField(-110)).toBe("-110");
  });

  it("uses CRLF row separators with a trailing newline", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });
});

describe("GET /api/export/bets.csv", () => {
  it("exports only the user's bets with a stable header and proper escaping", async () => {
    const { row: me, clerkUserId } = await createUser();
    const { row: other } = await createUser();
    currentClerkUserId = clerkUserId;

    const trickyEvent = 'Chiefs, "The Champs"\nvs Raiders';
    await db.insert(betsTable).values([
      {
        userId: me.id,
        sport: "NFL",
        event: trickyEvent,
        betType: "moneyline",
        pick: "Chiefs ML",
        odds: -110,
        stake: "100",
        potentialPayout: "190.91",
        gameDate: "2026-01-05",
        confidenceScore: 5,
        tags: ["primetime", "fade"],
      },
      {
        userId: other.id,
        sport: "NBA",
        event: "Someone else's game",
        betType: "spread",
        pick: "Lakers -3",
        odds: -105,
        stake: "50",
        potentialPayout: "97.62",
        gameDate: "2026-01-06",
        confidenceScore: 3,
      },
    ]);

    const res = await request(app).get("/api/export/bets.csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="edgeboard-bets-\d{4}-\d{2}-\d{2}\.csv"/);

    // UTF-8 BOM for Excel encoding detection, stripped before parsing.
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const text = res.text.slice(1);
    const lines = text.replace(/\r\n$/, "").split("\r\n");
    // Header row is the contract.
    expect(parseCsvLine(lines[0])).toEqual(BET_CSV_HEADER);
    // The embedded newline lives inside quotes, so logical rows = 1 data row
    // even though the raw text has an extra physical line.
    expect(text).toContain('"Chiefs, ""The Champs""\nvs Raiders"');
    expect(text).not.toContain("Someone else's game");
    expect(text).toContain("primetime; fade");
  });
});

describe("GET /api/export/parlays.csv", () => {
  it("exports one row per leg with parlay columns repeated", async () => {
    const { row: me, clerkUserId } = await createUser();
    currentClerkUserId = clerkUserId;

    const [parlay] = await db
      .insert(parlaysTable)
      .values({
        userId: me.id,
        name: "Sunday Special, with commas",
        stake: "50",
        odds: 264,
        potentialPayout: "182.00",
        confidenceScore: 3,
      })
      .returning();
    await db.insert(parlayLegsTable).values([
      { parlayId: parlay.id, sport: "NFL", event: "Game A", betType: "moneyline", pick: "Pick A", odds: -110, gameDate: "2026-01-05" },
      { parlayId: parlay.id, sport: "NBA", event: "Game B", betType: "spread", pick: "Pick B", odds: -105, gameDate: "2026-01-06" },
    ]);

    const res = await request(app).get("/api/export/parlays.csv");
    expect(res.status).toBe(200);

    const lines = res.text.replace(/^\ufeff/, "").replace(/\r\n$/, "").split("\r\n");
    expect(parseCsvLine(lines[0])).toEqual(PARLAY_CSV_HEADER);
    expect(lines).toHaveLength(3); // header + 2 leg rows

    const row1 = parseCsvLine(lines[1]);
    const row2 = parseCsvLine(lines[2]);
    const idCol = PARLAY_CSV_HEADER.indexOf("parlay_id");
    const legNoCol = PARLAY_CSV_HEADER.indexOf("leg_number");
    const legEventCol = PARLAY_CSV_HEADER.indexOf("leg_event");
    expect(row1[idCol]).toBe(String(parlay.id));
    expect(row2[idCol]).toBe(String(parlay.id));
    expect(row1[legNoCol]).toBe("1");
    expect(row2[legNoCol]).toBe("2");
    expect([row1[legEventCol], row2[legEventCol]].sort()).toEqual(["Game A", "Game B"]);
  });
});

describe("GET /api/export/bankroll.csv", () => {
  it("exports the user's ledger oldest-first with a stable header", async () => {
    const { row: me, clerkUserId } = await createUser();
    currentClerkUserId = clerkUserId;

    await db.insert(transactionsTable).values([
      { userId: me.id, type: "deposit", amount: "200.00", balanceAfter: "1200.00", note: "Weekly reload, extra" },
      { userId: me.id, type: "withdraw", amount: "-50.00", balanceAfter: "1150.00", note: null },
    ]);

    const res = await request(app).get("/api/export/bankroll.csv");
    expect(res.status).toBe(200);

    const lines = res.text.replace(/^\ufeff/, "").replace(/\r\n$/, "").split("\r\n");
    expect(parseCsvLine(lines[0])).toEqual(TRANSACTION_CSV_HEADER);
    expect(lines).toHaveLength(3);

    const typeCol = TRANSACTION_CSV_HEADER.indexOf("type");
    const amountCol = TRANSACTION_CSV_HEADER.indexOf("amount");
    const row1 = parseCsvLine(lines[1]);
    const row2 = parseCsvLine(lines[2]);
    expect(row1[typeCol]).toBe("deposit");
    expect(row2[typeCol]).toBe("withdraw");
    expect(row2[amountCol]).toBe("-50");
  });

  it("requires a linked profile", async () => {
    currentClerkUserId = `clerk_missing_${Date.now()}`;
    const res = await request(app).get("/api/export/bankroll.csv");
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests with 401", async () => {
    currentClerkUserId = null;
    for (const path of ["/api/export/bets.csv", "/api/export/parlays.csv", "/api/export/bankroll.csv"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });
});
