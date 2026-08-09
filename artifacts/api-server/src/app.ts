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
 * Cross-origin access is opt-in in production. Same-origin deployments need
 * no CORS headers; split frontend/API deployments can provide a comma-separated
 * ALLOWED_ORIGINS list (for example https://app.example.com).
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

// Standard Clerk configuration. @clerk/express reads CLERK_PUBLISHABLE_KEY and
// CLERK_SECRET_KEY from the environment, which keeps auth portable across hosts.
app.use(clerkMiddleware());

// Unauthenticated liveness endpoint for load balancers and container hosts.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", service: "tiltcheck-api" });
});

app.use("/api", router);

export default app;
