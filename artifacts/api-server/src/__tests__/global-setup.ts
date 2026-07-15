/**
 * Vitest global setup: serialize whole-suite runs against the shared dev
 * database.
 *
 * The api-server integration tests hit the real dev Postgres, and two files
 * (recap.test.ts, narrative.test.ts) wipe entire tables to get a
 * deterministic world. If two copies of the suite ever run at the same time
 * (e.g. a validation runner and a manual run, or a duplicated CI step), those
 * wipes race everything else: users vanish mid-test, inserts hit foreign-key
 * violations, and random files fail with `delete from "users"` errors.
 *
 * A session-level Postgres advisory lock makes the whole suite mutually
 * exclusive: the second run simply waits for the first to finish instead of
 * corrupting it. Servers and other processes are unaffected -- only suite
 * runs take this lock.
 */
import { pool } from "@workspace/db";

// Arbitrary but stable app-specific key for pg_advisory_lock.
const SUITE_LOCK_KEY = 727_401_913;

// Minimal structural type for the checked-out client; `pool.connect()` has a
// callback overload, so its return type can't be inferred directly, and the
// `pg` types aren't importable across this package boundary.
type LockClient = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

let lockClient: LockClient | undefined;

export async function setup() {
  lockClient = await pool.connect();
  await lockClient.query("SELECT pg_advisory_lock($1)", [SUITE_LOCK_KEY]);
}

export async function teardown() {
  if (lockClient) {
    try {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [SUITE_LOCK_KEY]);
    } finally {
      lockClient.release();
    }
  }
  // This pool instance lives in vitest's main process (workers have their
  // own); close it so the runner can exit cleanly.
  await pool.end();
}
