import app from "./app";
import { logger } from "./lib/logger";
import { ensureDemoSeeded } from "./lib/demo-seed";
import { ensureCrewsBootstrapped } from "./lib/crews";
import { startNotificationWorker } from "./lib/notificationWorker";

const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Self-seed the public demo board when its world is empty (first production
  // boot, or a dev database that tests have wiped). Idempotent and non-blocking.
  ensureDemoSeeded()
    .then((result) => {
      if (result.seeded) {
        logger.info({ users: result.users }, "Demo board seeded");
      }
    })
    .catch((err) => {
      logger.error({ err }, "Demo board seeding failed");
    })
    .finally(() => {
      ensureCrewsBootstrapped().catch((err) => {
        logger.error({ err }, "Crews bootstrap failed");
      });
      // Skips silently if VAPID keys are not configured.
      startNotificationWorker();
    });
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received");
  server.close((err) => {
    if (err) {
      logger.error({ err }, "Graceful shutdown failed");
      process.exit(1);
    }
    logger.info("Server closed cleanly");
    process.exit(0);
  });

  // Do not let a stuck connection hold a rolling deployment forever.
  setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
