import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger, httpLogSerializers } from "./lib/logger";

const app: Express = express();

/**
 * Hosting platforms differ in how many reverse-proxy hops sit in front of the
 * Node process. Do not hard-code a vendor topology: set TRUST_PROXY_HOPS to a
 * positive integer on hosts that forward the client IP (commonly `1`).
 */
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "0");
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
}
app.set("trust proxy", trustProxyHops === 0 ? false : trustProxyHops);

app.use(
  pinoHttp({
    logger,
    serializers: httpLogSerializers,
  }),
);

/**
 * Cross-origin access is opt-in in production. The preferred beta deployment
 * is same-origin (Express serves the built React app), which needs no CORS.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin:
      allowedOrigins.length > 0
        ? allowedOrigins
        : process.env.NODE_ENV === "production"
          ? false
          : true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Unauthenticated liveness endpoint for load balancers and container hosts.
// Keep this before auth middleware so a missing/misconfigured auth provider
// cannot make the process appear dead to the host.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", service: "tiltcheck-api" });
});

// Standard Clerk configuration. @clerk/express reads CLERK_PUBLISHABLE_KEY and
// CLERK_SECRET_KEY from the environment, which keeps auth portable across hosts.
app.use(clerkMiddleware());

app.use("/api", router);

/**
 * Production is intentionally a single-origin app: one Node service serves
 * both the API and the already-built React assets. That keeps Clerk callbacks,
 * cookies, generated `/api/*` calls, custom domains, and beta deployment simple.
 *
 * `pnpm --filter @workspace/api-server run start` executes with the API package
 * as cwd; direct root-level starts are also supported by checking both paths.
 */
if (process.env.NODE_ENV === "production") {
  const webDist = [
    path.resolve(process.cwd(), "../edgeboard/dist/public"),
    path.resolve(process.cwd(), "artifacts/edgeboard/dist/public"),
  ].find((candidate) => existsSync(path.join(candidate, "index.html")));

  if (webDist) {
    app.use(express.static(webDist, { index: false }));

    // SPA fallback after API/static routes. Never turn an API 404 into HTML.
    app.use((req, res, next) => {
      if (
        req.method !== "GET" ||
        req.path === "/healthz" ||
        req.path === "/api" ||
        req.path.startsWith("/api/")
      ) {
        return next();
      }
      return res.sendFile(path.join(webDist, "index.html"));
    });

    logger.info({ webDist }, "Serving TiltCheck web build from API service");
  } else {
    logger.warn(
      "Production web build not found; API will run without static frontend assets",
    );
  }
}

export default app;
