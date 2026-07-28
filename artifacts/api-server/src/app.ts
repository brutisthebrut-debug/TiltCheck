import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger, httpLogSerializers } from "./lib/logger";

const app: Express = express();

// Railway, Render, Fly, and most managed Node hosts place the service one hop
// behind their edge proxy. The value stays explicit so rate limiting never
// trusts an arbitrary X-Forwarded-For chain.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "1");
app.set(
  "trust proxy",
  Number.isInteger(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1,
);

app.use(
  pinoHttp({
    logger,
    serializers: httpLogSerializers,
  }),
);

const configuredOrigins = [
  process.env.APP_ORIGIN,
  ...(process.env.CORS_ALLOWED_ORIGINS ?? "").split(","),
]
  .map((origin) => origin?.trim().replace(/\/$/, ""))
  .filter((origin): origin is string => Boolean(origin));

if (process.env.NODE_ENV !== "production") {
  configuredOrigins.push("http://localhost:5173", "http://127.0.0.1:5173");
}

const allowedOrigins = new Set(configuredOrigins);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Non-browser and same-origin traffic does not require CORS headers.
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, allowedOrigins.has(origin.replace(/\/$/, "")));
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Clerk reads CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY directly from the
// environment. This works on any host and avoids a platform-owned auth proxy.
app.use(clerkMiddleware());

app.use("/api", router);

// The production service ships the Vite app and API together on one origin.
// In development Vite serves the frontend and proxies /api to this process.
if (process.env.NODE_ENV === "production") {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(
    moduleDir,
    "../../edgeboard/dist/public",
  );

  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) {
        next();
        return;
      }

      res.sendFile(path.join(frontendDist, "index.html"));
    });
  } else {
    logger.warn({ frontendDist }, "Frontend build was not found");
  }
}

export default app;
