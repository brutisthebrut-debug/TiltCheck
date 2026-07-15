---
name: Rate limiting behind the Replit proxy
description: How API rate limiting is keyed and why; test-env dormancy; Clerk prod keys are platform-managed.
---

**Keying rule:** limiters key per Clerk userId when signed in, else per `req.ip` with `app.set("trust proxy", 1)` — the server always sits exactly one hop behind the Replit proxy, so req.ip is the proxy-appended address and client-forged X-Forwarded-For prefixes can't rotate keys or inflate the in-memory store. Never parse the first XFF hop yourself.

**Why:** an architect review flagged first-hop XFF parsing as spoofable (bypass + unbounded key cardinality on the public demo mount).

**How to apply:** any new throttle/abuse control should reuse `makeLimiter` in the api-server middlewares; limiters are dormant under NODE_ENV=test (the suite shares one key) — test limiter behavior with `enforceAlways: true` on tiny local express apps. 429 bodies put the friendly text in `error` (the field the frontend surfaces), machine code in `code`.

**Clerk prod keys:** the project uses Replit-managed Clerk — pk_test/sk_test in dev, automatically swapped to pk_live/sk_live in deployments at publish. Never switch keys manually or touch the Clerk dashboard; dev and prod user stores are separate by design.
