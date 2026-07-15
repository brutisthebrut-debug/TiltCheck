import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger, httpLogSerializers } from "./lib/logger";

const app: Express = express();

// The server always sits one hop behind the Replit proxy in both dev preview
// and deployments. Trusting exactly that hop makes req.ip the real client
// address (the entry the proxy appended), while a spoofed X-Forwarded-For
// value sent by the client itself is ignored — rate limiting keys off req.ip.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: httpLogSerializers,
  }),
);

// Clerk Frontend API proxy — must be mounted before body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
