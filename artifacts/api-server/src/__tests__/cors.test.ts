import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

process.env.APP_ORIGIN = "https://tiltcheck.example";

import app from "../app";

describe("browser origin boundaries", () => {
  it("returns credentialed CORS headers to the configured app", async () => {
    const res = await request(app)
      .get("/api/healthz")
      .set("Origin", "https://tiltcheck.example");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://tiltcheck.example");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not grant CORS access to an unapproved origin", async () => {
    const res = await request(app)
      .get("/api/healthz")
      .set("Origin", "https://attacker.example");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
