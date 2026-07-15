/**
 * Billing — TiltCheck Pro subscription:
 *   - GET /billing/status: 401 unauthenticated; founder/demo bypass; cached
 *     proUntil horizon served without touching Whop; lapsed horizon re-verified
 *     with Whop and stamped back; provider failure → 503, never silent access
 *   - POST /billing/checkout: validates returnUrl, refuses when already Pro,
 *     creates a hosted checkout config and stores its id on the user
 *   - requirePro gate: free accounts get 402 on the insight-layer endpoints,
 *     a live horizon opens them (covered per-endpoint by their own suites)
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

let currentClerkUserId: string | null = null;

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers?: Record<string, string | string[] | undefined> }) => ({
    userId: (req?.headers?.["x-test-clerk-id"] as string | undefined) ?? currentClerkUserId,
  }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        primaryEmailAddress: { emailAddress: `${id}@example.com` },
        emailAddresses: [{ emailAddress: `${id}@example.com` }],
        firstName: "Test",
        lastName: "User",
      }),
    },
  },
}));

const mockPaymentsList = vi.fn();
const mockMembershipsRetrieve = vi.fn();
const mockCheckoutCreate = vi.fn();
const mockCheckoutRetrieve = vi.fn();

vi.mock("../whopClient", () => ({
  getWhopClient: async () => ({
    payments: { list: mockPaymentsList },
    memberships: { retrieve: mockMembershipsRetrieve },
    checkoutConfigurations: { create: mockCheckoutCreate, retrieve: mockCheckoutRetrieve },
  }),
}));

process.env.BETA_SEAT_LIMIT = "0";
process.env.WHOP_COMPANY_ID = "biz_test";
process.env.WHOP_PLAN_ID = "plan_test";

import app from "../app";
import { db, pool, usersTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

const FUTURE = new Date("2099-01-01T00:00:00Z");
const PAST = new Date("2020-01-01T00:00:00Z");

async function createLinkedUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const username = `bill_${Date.now()}_${counter++}`;
  const clerkUserId = `clerk_${username}`;
  const [row] = await db
    .insert(usersTable)
    .values({ username, displayName: username, clerkUserId, ...overrides })
    .returning();
  createdUserIds.push(row.id);
  return { user: row, clerkUserId };
}

beforeEach(() => {
  mockPaymentsList.mockReset();
  mockMembershipsRetrieve.mockReset();
  mockCheckoutCreate.mockReset();
  mockCheckoutRetrieve.mockReset();
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

describe("GET /billing/status", () => {
  it("rejects unauthenticated requests", async () => {
    currentClerkUserId = null;
    const res = await request(app).get("/api/billing/status");
    expect(res.status).toBe(401);
  });

  it("founders are always Pro without touching Whop", async () => {
    const { clerkUserId } = await createLinkedUser({ isFounder: true });
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/billing/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isPro: true, proUntil: null, source: "founder" });
    expect(mockPaymentsList).not.toHaveBeenCalled();
  });

  it("fresh user with no checkout history is not Pro", async () => {
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/billing/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isPro: false, proUntil: null, source: "none" });
    expect(mockPaymentsList).not.toHaveBeenCalled();
  });

  it("serves a live cached horizon without calling Whop", async () => {
    const { clerkUserId } = await createLinkedUser({ proUntil: FUTURE, whopCheckoutConfigId: "ch_x" });
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/billing/status");
    expect(res.status).toBe(200);
    expect(res.body.isPro).toBe(true);
    expect(res.body.source).toBe("subscription");
    expect(new Date(res.body.proUntil).getTime()).toBe(FUTURE.getTime());
    expect(mockPaymentsList).not.toHaveBeenCalled();
  });

  it("re-verifies a lapsed horizon with Whop and stamps the new one", async () => {
    const { user, clerkUserId } = await createLinkedUser({ proUntil: PAST, whopCheckoutConfigId: "ch_y" });
    currentClerkUserId = clerkUserId;
    mockPaymentsList.mockResolvedValue({ data: [{ membership: "mem_1" }] });
    mockMembershipsRetrieve.mockResolvedValue({ status: "active", renewal_period_end: "2099-06-01T00:00:00Z" });

    const res = await request(app).get("/api/billing/status");
    expect(res.status).toBe(200);
    expect(res.body.isPro).toBe(true);
    expect(res.body.source).toBe("subscription");
    // Horizon is capped at ~24h even when the renewal period runs longer.
    const horizon = new Date(res.body.proUntil).getTime();
    expect(horizon).toBeGreaterThan(Date.now());
    expect(horizon).toBeLessThanOrEqual(Date.now() + 25 * 60 * 60 * 1000);

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row.proUntil?.getTime()).toBe(horizon);
  });

  it("a cancelled membership does not grant access", async () => {
    const { clerkUserId } = await createLinkedUser({ proUntil: PAST, whopCheckoutConfigId: "ch_z" });
    currentClerkUserId = clerkUserId;
    mockPaymentsList.mockResolvedValue({ data: [{ membership: "mem_2" }] });
    mockMembershipsRetrieve.mockResolvedValue({ status: "canceled", valid: false });

    const res = await request(app).get("/api/billing/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isPro: false, proUntil: null, source: "none" });
  });

  it("provider failure surfaces as 503, never as silent access", async () => {
    const { clerkUserId } = await createLinkedUser({ proUntil: PAST, whopCheckoutConfigId: "ch_f" });
    currentClerkUserId = clerkUserId;
    mockPaymentsList.mockRejectedValue(new Error("whop down"));

    const res = await request(app).get("/api/billing/status");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("billing_unavailable");
  });
});

describe("POST /billing/checkout", () => {
  it("rejects a relative returnUrl", async () => {
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    const res = await request(app).post("/api/billing/checkout").send({ returnUrl: "/account" });
    expect(res.status).toBe(400);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("refuses when already Pro (founder or live horizon)", async () => {
    const founder = await createLinkedUser({ isFounder: true });
    currentClerkUserId = founder.clerkUserId;
    const asFounder = await request(app)
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://app.example/account?upgraded=1" });
    expect(asFounder.status).toBe(409);

    const paid = await createLinkedUser({ proUntil: FUTURE });
    currentClerkUserId = paid.clerkUserId;
    const asPaid = await request(app)
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://app.example/account?upgraded=1" });
    expect(asPaid.status).toBe(409);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("creates a checkout config, stores its id, and returns the hosted URL", async () => {
    const { user, clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    mockCheckoutCreate.mockResolvedValue({ id: "ch_new", purchase_url: "https://whop.com/checkout/ch_new" });

    const res = await request(app)
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://app.example/account?upgraded=1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checkoutUrl: "https://whop.com/checkout/ch_new" });
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: "plan_test",
        redirect_url: "https://app.example/account?upgraded=1",
        metadata: { appUserId: String(user.id) },
      }),
    );

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row.whopCheckoutConfigId).toBe("ch_new");
  });

  it("an earlier paid checkout refreshes the horizon and refuses a double-charge", async () => {
    const { user, clerkUserId } = await createLinkedUser({ whopCheckoutConfigId: "ch_old" });
    currentClerkUserId = clerkUserId;
    mockPaymentsList.mockResolvedValue({ data: [{ membership: "mem_3" }] });
    mockMembershipsRetrieve.mockResolvedValue({ status: "active" });

    const res = await request(app)
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://app.example/account?upgraded=1" });
    expect(res.status).toBe(409);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row.proUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(row.whopCheckoutConfigId).toBe("ch_old");
  });

  it("reuses an existing unpaid checkout session instead of minting another", async () => {
    const returnUrl = "https://app.example/account?upgraded=1";
    const { user, clerkUserId } = await createLinkedUser({ whopCheckoutConfigId: "ch_reuse" });
    currentClerkUserId = clerkUserId;
    mockPaymentsList.mockResolvedValue({ data: [] }); // no payments yet
    mockCheckoutRetrieve.mockResolvedValue({
      purchase_url: "https://whop.com/checkout/ch_reuse",
      redirect_url: returnUrl,
    });

    const res = await request(app).post("/api/billing/checkout").send({ returnUrl });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checkoutUrl: "https://whop.com/checkout/ch_reuse" });
    expect(mockCheckoutCreate).not.toHaveBeenCalled();

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row.whopCheckoutConfigId).toBe("ch_reuse");
  });

  it("concurrent checkout requests mint exactly one chargeable session", async () => {
    const returnUrl = "https://app.example/account?upgraded=1";
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    mockPaymentsList.mockResolvedValue({ data: [] });
    mockCheckoutCreate.mockResolvedValue({ id: "ch_once", purchase_url: "https://whop.com/checkout/ch_once" });
    // The request that loses the race re-reads the row, finds ch_once, and
    // reuses it via retrieve instead of creating a second session.
    mockCheckoutRetrieve.mockResolvedValue({
      purchase_url: "https://whop.com/checkout/ch_once",
      redirect_url: returnUrl,
    });

    const [a, b] = await Promise.all([
      request(app).post("/api/billing/checkout").send({ returnUrl }),
      request(app).post("/api/billing/checkout").send({ returnUrl }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.checkoutUrl).toBe("https://whop.com/checkout/ch_once");
    expect(b.body.checkoutUrl).toBe("https://whop.com/checkout/ch_once");
    expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
  });

  it("provider failure during checkout creation surfaces as 503", async () => {
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    mockCheckoutCreate.mockRejectedValue(new Error("whop down"));

    const res = await request(app)
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://app.example/account?upgraded=1" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("billing_unavailable");
  });
});

describe("requirePro gate", () => {
  it("free accounts get a 402 on every insight-layer endpoint", async () => {
    const { clerkUserId } = await createLinkedUser();
    currentClerkUserId = clerkUserId;
    for (const path of [
      "/api/stats/leak-profile",
      "/api/stats/edge-finder",
      "/api/stats/insights",
      "/api/workspace/compare",
    ]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(402);
      expect(res.body.error, path).toBe("pro_required");
    }
  });

  it("an expired horizon closes the gate again", async () => {
    const { clerkUserId } = await createLinkedUser({ proUntil: PAST });
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/stats/leak-profile");
    expect(res.status).toBe(402);
  });

  it("a live horizon opens the gate", async () => {
    const { clerkUserId } = await createLinkedUser({ proUntil: FUTURE });
    currentClerkUserId = clerkUserId;
    const res = await request(app).get("/api/stats/leak-profile");
    expect(res.status).toBe(200);
  });
});
