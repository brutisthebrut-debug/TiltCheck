/**
 * Force-reseed the public demo board (fictional 5-person crew).
 *
 * The API server auto-seeds an empty demo world at boot; use this script when
 * you want to wipe and rebuild it — e.g. after the api-server test suite has
 * cleaned out the dev database, or after changing the seed logic.
 *
 * Run with: pnpm --filter @workspace/scripts run seed-demo-board
 */
import { seedDemoBoard } from "../../artifacts/api-server/src/lib/demo-seed";

seedDemoBoard({ force: true })
  .then((result) => {
    console.log(`Demo board reseeded: ${result.users} demo users.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
