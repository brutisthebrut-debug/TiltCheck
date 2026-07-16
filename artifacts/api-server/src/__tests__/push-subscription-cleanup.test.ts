/**
 * Push subscription lifecycle hardening. Proves the delivery-failure
 * contract in sendPush:
 *  - a permanently invalid subscription (410 Gone / 404) is deleted the
 *    moment a send fails, so a dead browser endpoint is never retried forever
 *  - a transient failure (e.g. 500 from the push service) keeps the row so
 *    delivery resumes when the service recovers
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { inArray, eq } from "drizzle-orm";

const sendNotificationMock = vi.fn();
vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
    setVapidDetails: vi.fn(),
  },
}));

import { sendPush } from "../lib/notificationWorker";
import { db, pool, usersTable, pushSubscriptionsTable } from "@workspace/db";

const createdUserIds: number[] = [];
let counter = 0;

async function createUserWithSub() {
  const username = `test_push_${Date.now()}_${counter++}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Push Tester",
      avatarColor: "#6366f1",
      startingBankroll: "1000",
      clerkUserId: `clerk_${username}`,
    })
    .returning();
  createdUserIds.push(user.id);
  const endpoint = `https://push.example.com/sub/${username}`;
  await db.insert(pushSubscriptionsTable).values({
    userId: user.id,
    endpoint,
    p256dhKey: "test-p256dh",
    authKey: "test-auth",
  });
  return { user, endpoint };
}

async function subExists(endpoint: string) {
  const rows = await db
    .select({ id: pushSubscriptionsTable.id })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));
  return rows.length > 0;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db
      .delete(pushSubscriptionsTable)
      .where(inArray(pushSubscriptionsTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await pool.end();
});

const PAYLOAD = { title: "t", body: "b", url: "/", tag: "test" };

describe("sendPush cleans up permanently invalid subscriptions", () => {
  it("deletes the row when the push service says 410 Gone", async () => {
    const { endpoint } = await createUserWithSub();
    sendNotificationMock.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));

    await sendPush({ endpoint, p256dhKey: "test-p256dh", authKey: "test-auth" }, PAYLOAD);

    expect(await subExists(endpoint)).toBe(false);
  });

  it("deletes the row when the push service says 404", async () => {
    const { endpoint } = await createUserWithSub();
    sendNotificationMock.mockRejectedValueOnce(Object.assign(new Error("nope"), { statusCode: 404 }));

    await sendPush({ endpoint, p256dhKey: "test-p256dh", authKey: "test-auth" }, PAYLOAD);

    expect(await subExists(endpoint)).toBe(false);
  });

  it("keeps the row on a transient failure so delivery can recover", async () => {
    const { endpoint } = await createUserWithSub();
    sendNotificationMock.mockRejectedValueOnce(Object.assign(new Error("busy"), { statusCode: 500 }));

    await sendPush({ endpoint, p256dhKey: "test-p256dh", authKey: "test-auth" }, PAYLOAD);

    expect(await subExists(endpoint)).toBe(true);
  });

  it("keeps the row on success", async () => {
    const { endpoint } = await createUserWithSub();
    sendNotificationMock.mockResolvedValueOnce({});

    await sendPush({ endpoint, p256dhKey: "test-p256dh", authKey: "test-auth" }, PAYLOAD);

    expect(await subExists(endpoint)).toBe(true);
  });
});
