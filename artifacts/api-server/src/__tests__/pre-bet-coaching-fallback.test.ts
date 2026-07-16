/**
 * Arc pre-bet coaching — provider failure behavior (#184). Proves:
 *  - a working provider returns 200 with the note
 *  - a throwing provider returns 503 `coaching_unavailable` (never a hang,
 *    never a fake note)
 *  - an EMPTY provider response is treated as a failure → 503
 *  - a provider that never answers is cut off by the request deadline
 *    (PRE_BET_AI_TIMEOUT_MS) → 503, so a slow provider can't hang the form
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
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

// The AI provider is mocked — tests never hit the network.
const generateMock = vi.fn();
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => generateMock(...args) } } },
}));

import app from "../app";
import { db, pool, usersTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createProUser() {
  const username = `arc_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: username,
      clerkUserId,
      // Founders pass requirePro without touching the billing provider.
      isFounder: true,
    })
    .returning();
  createdUserIds.push(row.id);
  return { user: row, clerkUserId };
}

beforeEach(() => {
  generateMock.mockReset();
  delete process.env.PRE_BET_AI_TIMEOUT_MS;
});

afterAll(async () => {
  delete process.env.PRE_BET_AI_TIMEOUT_MS;
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

const BODY = { sport: "NBA", odds: -110 };

describe("POST /stats/pre-bet-check — provider failure fallback", () => {
  it("returns the note when the provider answers", async () => {
    const { clerkUserId } = await createProUser();
    currentClerkUserId = clerkUserId;
    generateMock.mockResolvedValue({
      choices: [{ message: { content: "You're 2-9 on NBA dogs. Your call." } }],
    });

    const res = await request(app).post("/api/stats/pre-bet-check").send(BODY);
    expect(res.status).toBe(200);
    expect(res.body.note).toBe("You're 2-9 on NBA dogs. Your call.");
  });

  it("returns 503 coaching_unavailable when the provider throws", async () => {
    const { clerkUserId } = await createProUser();
    currentClerkUserId = clerkUserId;
    generateMock.mockRejectedValue(new Error("provider down"));

    const res = await request(app).post("/api/stats/pre-bet-check").send(BODY);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("coaching_unavailable");
    expect(res.body.message).toBeTruthy();
  });

  it("treats an empty provider response as a failure → 503", async () => {
    const { clerkUserId } = await createProUser();
    currentClerkUserId = clerkUserId;
    generateMock.mockResolvedValue({ choices: [{ message: { content: "" } }] });

    const res = await request(app).post("/api/stats/pre-bet-check").send(BODY);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("coaching_unavailable");
  });

  it("cuts off a hanging provider at the deadline → 503, no hang", async () => {
    const { clerkUserId } = await createProUser();
    currentClerkUserId = clerkUserId;
    process.env.PRE_BET_AI_TIMEOUT_MS = "150";
    // Never resolves — only the route's own deadline can end this request.
    generateMock.mockImplementation(() => new Promise(() => {}));

    const started = Date.now();
    const res = await request(app).post("/api/stats/pre-bet-check").send(BODY);
    const elapsed = Date.now() - started;

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("coaching_unavailable");
    // Well under the 8s production default — proves the env deadline applied.
    expect(elapsed).toBeLessThan(5000);
  });
});
