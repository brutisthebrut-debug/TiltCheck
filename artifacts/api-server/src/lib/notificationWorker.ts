/**
 * TiltCheck notification worker — runs every 15 minutes, checks each
 * subscribed bettor for actionable events (overdue bets, tilt spiral, crew
 * activity) and fires web-push payloads where warranted.
 *
 * Rate-limiting: each type has a per-user cooldown so we never spam:
 *   - overdue: 24 h between reminders
 *   - tilt:    4 h between warnings (a spiral ends or changes within hours)
 *   - crew:    15 min (the worker interval — one burst per check)
 */

import webpush from "web-push";
import { db } from "@workspace/db";
import {
  pushSubscriptionsTable,
  betsTable,
  parlaysTable,
  usersTable,
  crewMembersTable,
} from "@workspace/db";
import { and, eq, lt, gte, inArray, isNotNull } from "drizzle-orm";
import { dayOf } from "@workspace/weeks";
import { logger } from "./logger";
import { getOrRefreshPercentiles } from "./peerBenchmarks";

// ── VAPID setup ────────────────────────────────────────────────────────────

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT ?? "mailto:admin@tiltcheck.app";
  if (!pub || !priv) {
    logger.warn("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push disabled");
    return;
  }
  webpush.setVapidDetails(sub, pub, priv);
  vapidConfigured = true;
}

// ── Push helper ───────────────────────────────────────────────────────────

// Exported for tests: the 410/404 cleanup contract below is load-bearing —
// it's what keeps dead browser endpoints from being retried forever.
export async function sendPush(
  sub: { endpoint: string; p256dhKey: string; authKey: string },
  payload: { title: string; body: string; url: string; tag: string }
) {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 6 } // 6 h TTL — expired if undelivered in 6 h
    );
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 410 || status === 404) {
      // Subscription gone — remove it so we don't try again
      await db
        .delete(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
    } else {
      logger.warn({ err, endpoint: sub.endpoint.slice(0, 40) }, "push: send failed");
    }
  }
}

// ── Tilt detection (mirrors stats route logic) ────────────────────────────

const TILT_WINDOW_HOURS = 12;
const TILT_MIN_LOSSES = 2;
const TILT_MIN_PLAYS = 3;
const TILT_STAKE_RATIO = 1.5;

/** Details of an active tilt spiral, used to explain WHY the warning fired (#183). */
type TiltSpiralDetails = {
  recentLosses: number;
  rapidPlays: number;
  stakeRatio: number;
  windowHours: number;
};

async function getTiltSpiral(userId: number): Promise<TiltSpiralDetails | null> {
  // Step 1: avg stake (lifetime) for meaningful comparison
  const allBets = await db
    .select({ stake: betsTable.stake, status: betsTable.status, settledAt: betsTable.settledAt })
    .from(betsTable)
    .where(and(eq(betsTable.userId, userId), isNotNull(betsTable.settledAt)));
  const allParlays = await db
    .select({ stake: parlaysTable.stake, status: parlaysTable.status, settledAt: parlaysTable.settledAt })
    .from(parlaysTable)
    .where(and(eq(parlaysTable.userId, userId), isNotNull(parlaysTable.settledAt)));

  const settled = [...allBets, ...allParlays];
  if (settled.length < 5) return null; // not enough history
  const avgStake = settled.reduce((s, r) => s + Number(r.stake), 0) / settled.length;
  if (avgStake <= 0) return null;

  // Step 2: recent losses
  const tiltCutoff = new Date(Date.now() - TILT_WINDOW_HOURS * 60 * 60 * 1000);
  const recentLossTimes = settled
    .filter((r) => r.status === "lost" && r.settledAt != null && r.settledAt >= tiltCutoff)
    .map((r) => r.settledAt!.getTime())
    .sort((a, b) => a - b);
  if (recentLossTimes.length < TILT_MIN_LOSSES) return null;

  // Step 3: burst of plays since first loss
  const firstLossAt = new Date(recentLossTimes[0]);
  const burstBets = await db
    .select({ stake: betsTable.stake })
    .from(betsTable)
    .where(and(eq(betsTable.userId, userId), gte(betsTable.createdAt, firstLossAt)));
  const burstParlays = await db
    .select({ stake: parlaysTable.stake })
    .from(parlaysTable)
    .where(and(eq(parlaysTable.userId, userId), gte(parlaysTable.createdAt, firstLossAt)));
  const burst = [...burstBets, ...burstParlays];
  if (burst.length < TILT_MIN_PLAYS) return null;

  const burstAvgStake = burst.reduce((s, r) => s + Number(r.stake), 0) / burst.length;
  const stakeRatio = burstAvgStake / avgStake;
  if (stakeRatio < TILT_STAKE_RATIO) return null;
  return {
    recentLosses: recentLossTimes.length,
    rapidPlays: burst.length,
    stakeRatio: Math.round(stakeRatio * 10) / 10,
    windowHours: TILT_WINDOW_HOURS,
  };
}

// ── Overdue bet detection ─────────────────────────────────────────────────

async function hasOverdueBets(userId: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const [bet] = await db
    .select({ id: betsTable.id })
    .from(betsTable)
    .where(
      and(
        eq(betsTable.userId, userId),
        eq(betsTable.status, "pending"),
        lt(betsTable.gameDate, dayOf(cutoff))
      )
    )
    .limit(1);
  if (bet) return true;
  // Parlays don't have a gameDate (that's per-leg); use createdAt as a
  // proxy — a parlay created and still pending after 48 h is overdue.
  const [parlay] = await db
    .select({ id: parlaysTable.id })
    .from(parlaysTable)
    .where(
      and(
        eq(parlaysTable.userId, userId),
        eq(parlaysTable.status, "pending"),
        lt(parlaysTable.createdAt, cutoff)
      )
    )
    .limit(1);
  return !!parlay;
}

// ── Crew activity detection ───────────────────────────────────────────────

const NOTABLE_WIN_THRESHOLD = 50; // net profit $ to call it notable
const CREW_LOOK_BACK_MS = 16 * 60 * 1000; // slightly past the 15-min interval

async function getCrewActivity(
  userId: number,
  crewId: number
): Promise<{ name: string; amount: number; type: "bet" | "parlay" } | null> {
  const since = new Date(Date.now() - CREW_LOOK_BACK_MS);
  // Crew members other than this user
  const members = await db
    .select({ userId: crewMembersTable.userId })
    .from(crewMembersTable)
    .where(eq(crewMembersTable.crewId, crewId));
  const otherIds = members.map((m) => m.userId).filter((id) => id !== userId);
  if (otherIds.length === 0) return null;

  // Look for recently settled notable wins among crew members
  // profit = actualPayout - stake for won plays
  const recentBets = await db
    .select({
      userId: betsTable.userId,
      stake: betsTable.stake,
      actualPayout: betsTable.actualPayout,
      settledAt: betsTable.settledAt,
    })
    .from(betsTable)
    .where(
      and(
        inArray(betsTable.userId, otherIds),
        eq(betsTable.status, "won"),
        gte(betsTable.settledAt!, since),
        isNotNull(betsTable.actualPayout)
      )
    )
    .limit(1);

  if (recentBets.length > 0) {
    const hit = recentBets[0];
    const profit = Number(hit.actualPayout) - Number(hit.stake);
    if (profit >= NOTABLE_WIN_THRESHOLD) {
      const [member] = await db
        .select({ displayName: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, hit.userId));
      return { name: member?.displayName ?? "A crew member", amount: profit, type: "bet" };
    }
  }

  const recentParlays = await db
    .select({
      userId: parlaysTable.userId,
      stake: parlaysTable.stake,
      actualPayout: parlaysTable.actualPayout,
      settledAt: parlaysTable.settledAt,
    })
    .from(parlaysTable)
    .where(
      and(
        inArray(parlaysTable.userId, otherIds),
        eq(parlaysTable.status, "won"),
        gte(parlaysTable.settledAt!, since),
        isNotNull(parlaysTable.actualPayout)
      )
    )
    .limit(1);

  if (recentParlays.length > 0) {
    const hit = recentParlays[0];
    const profit = Number(hit.actualPayout) - Number(hit.stake);
    if (profit >= NOTABLE_WIN_THRESHOLD) {
      const [member] = await db
        .select({ displayName: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, hit.userId));
      return { name: member?.displayName ?? "A crew member", amount: profit, type: "parlay" };
    }
  }

  return null;
}

// ── Main worker loop ──────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const OVERDUE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const TILT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const CREW_COOLDOWN_MS = 15 * 60 * 1000;
let warmupTimer: NodeJS.Timeout | null = null;
let checkTimer: NodeJS.Timeout | null = null;

async function runNotificationCheck() {
  // #190: scheduled peer-benchmark refresh. getOrRefreshPercentiles is
  // staleness-guarded (7-day window) and singleflighted, so calling it every
  // tick is cheap — it only recomputes when the pool snapshot has aged out.
  // This keeps benchmarks fresh even when nobody loads the page.
  try {
    await getOrRefreshPercentiles();
  } catch (err) {
    logger.warn({ err }, "Notification worker: scheduled benchmark refresh failed");
  }

  if (!vapidConfigured) return;

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .innerJoin(usersTable, eq(pushSubscriptionsTable.userId, usersTable.id))
    .where(eq(usersTable.isDemo, false));

  for (const { push_subscriptions: sub, users: user } of subs) {
    // Overdue bets
    if (sub.notifyOverdue) {
      const cooldownPassed =
        !sub.lastOverdueNotifiedAt ||
        Date.now() - sub.lastOverdueNotifiedAt.getTime() >= OVERDUE_COOLDOWN_MS;
      if (cooldownPassed && (await hasOverdueBets(user.id))) {
        await sendPush(sub, {
          title: "TiltCheck · Pending play",
          body: "You've got a pending play that needs settling. Close it out.",
          url: "/bets",
          tag: "overdue",
        });
        await db
          .update(pushSubscriptionsTable)
          .set({ lastOverdueNotifiedAt: new Date() })
          .where(eq(pushSubscriptionsTable.id, sub.id));
      }
    }

    // Tilt spiral
    if (sub.notifyTilt) {
      const cooldownPassed =
        !sub.lastTiltNotifiedAt ||
        Date.now() - sub.lastTiltNotifiedAt.getTime() >= TILT_COOLDOWN_MS;
      const spiral = cooldownPassed ? await getTiltSpiral(user.id) : null;
      if (spiral) {
        // #183: say WHY — cite the losses, the burst, and the stake escalation
        // so the warning reads as evidence, not a vibe.
        await sendPush(sub, {
          title: "TiltCheck · Heads up",
          body: `${spiral.recentLosses} losses in the last ${spiral.windowHours}h, ${spiral.rapidPlays} quick plays since, stakes ${spiral.stakeRatio}x your usual. That's your tilt pattern — take a breath before the next one.`,
          url: "/stats",
          tag: "tilt",
        });
        await db
          .update(pushSubscriptionsTable)
          .set({ lastTiltNotifiedAt: new Date() })
          .where(eq(pushSubscriptionsTable.id, sub.id));
      }
    }

    // Crew activity
    if (sub.notifyCrewActivity && user.activeCrewId) {
      const cooldownPassed =
        !sub.lastCrewNotifiedAt ||
        Date.now() - sub.lastCrewNotifiedAt.getTime() >= CREW_COOLDOWN_MS;
      if (cooldownPassed) {
        const activity = await getCrewActivity(user.id, user.activeCrewId);
        if (activity) {
          const sign = activity.amount >= 0 ? "+" : "";
          await sendPush(sub, {
            title: "TiltCheck · Crew win",
            body: `${activity.name} just cashed ${sign}$${Math.round(activity.amount)} on a ${activity.type}. 👀`,
            url: "/workspace",
            tag: "crew-activity",
          });
          await db
            .update(pushSubscriptionsTable)
            .set({ lastCrewNotifiedAt: new Date() })
            .where(eq(pushSubscriptionsTable.id, sub.id));
        }
      }
    }
  }
}

export function startNotificationWorker() {
  if (warmupTimer || checkTimer) return;
  ensureVapid();
  // Even without VAPID keys the worker still runs: push sends are skipped
  // inside runNotificationCheck, but the scheduled benchmark refresh (#190)
  // must keep the peer pool fresh regardless of push configuration.
  logger.info(
    vapidConfigured
      ? "Notification worker started (15-min interval)"
      : "Notification worker started without VAPID keys (benchmark refresh only)"
  );

  // First check after a short warm-up delay, then every 15 min
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    runNotificationCheck().catch((err) =>
      logger.error({ err }, "Notification worker: initial check failed")
    );
    checkTimer = setInterval(() => {
      runNotificationCheck().catch((err) =>
        logger.error({ err }, "Notification worker: check failed")
      );
    }, CHECK_INTERVAL_MS);
  }, 30_000); // 30s warm-up
}

export function stopNotificationWorker() {
  if (warmupTimer) clearTimeout(warmupTimer);
  if (checkTimer) clearInterval(checkTimer);
  warmupTimer = null;
  checkTimer = null;
}
