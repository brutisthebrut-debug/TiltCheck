import app from "./app";
import { logger } from "./lib/logger";
import { ensureDemoSeeded } from "./lib/demo-seed";
import { ensureCrewsBootstrapped } from "./lib/crews";
import { startNotificationWorker, stopNotificationWorker } from "./lib/notificationWorker";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"] ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");

  // Self-seed the public demo board when its world is empty (first prod boot,
  // or a dev database that tests have wiped). Idempotent and non-blocking.
  ensureDemoSeeded()
    .then((result) => {
      if (result.seeded) {
        logger.info({ users: result.users }, "Demo board seeded");
      }
    })
    .catch((err) => {
      logger.error({ err }, "Demo board seeding failed");
    })
    // Crews bootstrap runs after demo seeding so a fresh demo world gets its
    // sealed crew in the same boot. Idempotent: migrates a pre-crews real
    // world into its first crew exactly once, then short-circuits forever.
    .finally(() => {
      ensureCrewsBootstrapped().catch((err) => {
        logger.error({ err }, "Crews bootstrap failed");
      });
      // Start push notification worker after the world is seeded.
      // Skips silently if VAPID keys are not configured.
      startNotificationWorker();
    });
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");
  stopNotificationWorker();

  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (err) => {
    try {
      await pool.end();
    } catch (poolErr) {
      logger.error({ err: poolErr }, "Database pool shutdown failed");
      err ??= poolErr instanceof Error ? poolErr : new Error("Database pool shutdown failed");
    } finally {
      clearTimeout(forceExit);
      if (err) logger.error({ err }, "Server shutdown failed");
      process.exit(err ? 1 : 0);
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
