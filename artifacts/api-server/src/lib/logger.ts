import pino from "pino";
import type { Options as PinoHttpOptions } from "pino-http";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Privacy guardrails: never let credentials, request bodies (bet data,
  // emails) or email fields reach the log stream, even if a future log call
  // passes a whole request or user object.
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "req.body",
    "res.body",
    "email",
    "*.email",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

/**
 * Request-log serializers: a completed request is logged as
 * method + path + status (pino-http adds responseTime). Bodies, query
 * strings, and headers are deliberately excluded — request bodies carry bet
 * data and emails, and query strings can carry filters worth keeping out of
 * plain-text logs.
 */
export const httpLogSerializers: PinoHttpOptions["serializers"] = {
  req(req) {
    return {
      id: req.id,
      method: req.method,
      url: req.url?.split("?")[0],
    };
  },
  res(res) {
    return {
      statusCode: res.statusCode,
    };
  },
};
