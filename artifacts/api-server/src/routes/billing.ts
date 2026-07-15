import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { CreateBillingCheckoutBody } from "@workspace/api-zod";
import { requireProfile } from "../middlewares/auth";
import { getWhopClient } from "../whopClient";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Advisory-lock namespace serializing checkout creation per user (paired with
// the user id). Distinct from the test suite's global lock key.
const CHECKOUT_LOCK_NS = 429_001;

// How long a Whop verification is trusted before re-checking. Bounded so a
// cancelled subscription loses access within a day without calling Whop on
// every gated request (the requirePro gate reads users.proUntil only).
const PRO_VERIFY_HORIZON_MS = 24 * 60 * 60 * 1000;

const ACTIVE_MEMBERSHIP_STATUSES = new Set(["active", "trialing", "completed"]);

type MembershipLike = {
  status?: string | null;
  valid?: boolean | null;
  renewal_period_end?: string | null;
};

/**
 * Asks Whop whether this bettor's checkout configuration produced a live
 * membership. Returns the horizon to stamp on users.proUntil (capped at 24h)
 * or null when there is no valid membership. Throws on provider errors —
 * callers decide how to surface that; access is never granted on failure.
 */
async function verifyProWithWhop(user: { whopCheckoutConfigId: string | null }): Promise<Date | null> {
  if (!user.whopCheckoutConfigId) return null;
  const companyId = process.env.WHOP_COMPANY_ID;
  if (!companyId) throw new Error("WHOP_COMPANY_ID is not configured");
  const client = await getWhopClient();
  const payments = (await client.payments.list({
    company_id: companyId,
    checkout_configuration_ids: [user.whopCheckoutConfigId],
  } as Parameters<typeof client.payments.list>[0])) as unknown as {
    data?: Array<{ membership?: string | { id?: string } | null }>;
  };
  for (const payment of payments?.data ?? []) {
    const membershipId =
      typeof payment.membership === "string" ? payment.membership : payment.membership?.id;
    if (!membershipId) continue;
    const membership = (await client.memberships.retrieve(membershipId)) as unknown as MembershipLike;
    const active =
      membership?.valid === true ||
      (membership?.status != null && ACTIVE_MEMBERSHIP_STATUSES.has(membership.status));
    if (!active) continue;
    const cap = new Date(Date.now() + PRO_VERIFY_HORIZON_MS);
    const periodEnd = membership?.renewal_period_end
      ? new Date(membership.renewal_period_end)
      : null;
    return periodEnd && periodEnd.getTime() > Date.now() && periodEnd < cap ? periodEnd : cap;
  }
  return null;
}

// GET /billing/status — server-verified Pro status. Re-checks Whop only when
// the cached horizon has lapsed; stamps the fresh horizon back on the profile.
router.get("/billing/status", requireProfile, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  if (user.isDemo) {
    res.json({ isPro: true, proUntil: null, source: "demo" });
    return;
  }
  if (user.isFounder) {
    res.json({ isPro: true, proUntil: null, source: "founder" });
    return;
  }
  if (user.proUntil && user.proUntil.getTime() > Date.now()) {
    res.json({ isPro: true, proUntil: user.proUntil.toISOString(), source: "subscription" });
    return;
  }
  if (!user.whopCheckoutConfigId) {
    res.json({ isPro: false, proUntil: null, source: "none" });
    return;
  }
  let horizon: Date | null;
  try {
    horizon = await verifyProWithWhop(user);
  } catch (err) {
    logger.error({ err, userId: user.id }, "billing: Whop verification failed");
    res.status(503).json({
      error: "billing_unavailable",
      message: "Couldn't reach the payment provider — try again in a minute.",
    });
    return;
  }
  if (!horizon) {
    res.json({ isPro: false, proUntil: null, source: "none" });
    return;
  }
  await db.update(usersTable).set({ proUntil: horizon }).where(eq(usersTable.id, user.id));
  res.json({ isPro: true, proUntil: horizon.toISOString(), source: "subscription" });
});

// POST /billing/checkout — create a hosted checkout session for TiltCheck Pro.
// The stored checkout configuration id is what later lets /billing/status
// verify the purchase; the redirect back to the app never grants access.
router.post("/billing/checkout", requireProfile, async (req, res): Promise<void> => {
  const body = CreateBillingCheckoutBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { returnUrl } = body.data;
  if (!/^https?:\/\//.test(returnUrl)) {
    res.status(400).json({ error: "returnUrl must be an absolute http(s) URL" });
    return;
  }
  const user = req.currentUser!;
  if (user.isFounder || (user.proUntil && user.proUntil.getTime() > Date.now())) {
    res.status(409).json({ error: "already_pro", message: "You're already on Pro." });
    return;
  }
  const planId = process.env.WHOP_PLAN_ID;
  if (!planId) {
    res.status(503).json({
      error: "billing_unconfigured",
      message: "Billing isn't configured on this environment.",
    });
    return;
  }
  try {
    const client = await getWhopClient();
    // A per-user advisory lock serializes concurrent checkout requests: two
    // rapid clicks can otherwise both pass the prechecks and mint two
    // chargeable checkout sessions. Inside the lock we re-read the row, so
    // whatever a racing request stamped is what this one sees.
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CHECKOUT_LOCK_NS}, ${user.id})`);
      const [fresh] = await tx.select().from(usersTable).where(eq(usersTable.id, user.id));
      if (!fresh) return { kind: "gone" as const };
      if (fresh.isFounder || (fresh.proUntil && fresh.proUntil.getTime() > Date.now())) {
        return { kind: "already" as const };
      }
      if (fresh.whopCheckoutConfigId) {
        // An earlier config that already produced a paid membership means
        // refresh the horizon and refuse a double-charge.
        const horizon = await verifyProWithWhop(fresh);
        if (horizon) {
          await tx.update(usersTable).set({ proUntil: horizon }).where(eq(usersTable.id, user.id));
          return { kind: "already" as const };
        }
        // Unpaid session already exists — reuse it instead of minting another
        // chargeable checkout, as long as it still redirects to the same place.
        try {
          const existing = (await client.checkoutConfigurations.retrieve(
            fresh.whopCheckoutConfigId,
          )) as unknown as { purchase_url?: string; redirect_url?: string };
          if (existing?.purchase_url && existing?.redirect_url === returnUrl) {
            return { kind: "url" as const, url: existing.purchase_url };
          }
        } catch {
          // Stale or deleted config — mint a fresh one below.
        }
      }
      const config = (await client.checkoutConfigurations.create({
        plan_id: planId,
        redirect_url: returnUrl,
        metadata: { appUserId: String(user.id) },
      } as Parameters<typeof client.checkoutConfigurations.create>[0])) as unknown as {
        id?: string;
        purchase_url?: string;
      };
      if (!config?.id || !config?.purchase_url) {
        throw new Error("Whop returned no checkout URL");
      }
      await tx
        .update(usersTable)
        .set({ whopCheckoutConfigId: config.id })
        .where(eq(usersTable.id, user.id));
      return { kind: "url" as const, url: config.purchase_url };
    });

    if (outcome.kind === "gone") {
      res.status(403).json({ error: "No bettor profile linked to this account" });
      return;
    }
    if (outcome.kind === "already") {
      res.status(409).json({ error: "already_pro", message: "You're already on Pro." });
      return;
    }
    res.json({ checkoutUrl: outcome.url });
  } catch (err) {
    logger.error({ err, userId: user.id }, "billing: checkout creation failed");
    res.status(503).json({
      error: "billing_unavailable",
      message: "Couldn't reach the payment provider — try again in a minute.",
    });
  }
});

export default router;
