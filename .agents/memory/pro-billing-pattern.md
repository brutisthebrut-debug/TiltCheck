---
name: Pro billing verification pattern
description: How TiltCheck Pro access is granted/verified via Whop, and the guardrails around it
---

# Pro billing (Whop) — verification chain and guardrails

**Rule:** Pro access is granted only by server-side verification: payments listed by the user's stored checkout-config id → membership status retrieved → a horizon (min of renewal end, now+24h) stamped on `users.proUntil`. Redirect params and client state never grant access. Provider failure → 503 `billing_unavailable`, never silent access.

**Why:** Hosted checkout redirects are forgeable; caching a short horizon avoids a Whop round-trip per request while bounding how long a cancelled sub keeps access.

**How to apply:**
- `requirePro` middleware (402 `pro_required`) allows demo, founder, or live `proUntil`. Gated surfaces: leak-profile, edge-finder, stats insights, workspace compare. Billing router is mounted only in the authed section — the demo router has none, and the frontend demo mode switches billing sync off (demo is always Pro).
- Checkout creation is serialized per user with a pg advisory xact lock (namespace 429001, user id) + re-read inside the transaction; an existing unpaid session is reused (retrieve, match redirect_url) instead of minting another chargeable config. Never overwrite a config id without first verifying the old one isn't paid.
- Frontend `useProStatus` exposes `isProUnknown` (status fetch error): consumers must not show upgrade cards on unknown — show nothing or a neutral retry. Pro-gated queries use `enabled: isPro && ...` so 402s never hit the retry-card machinery.
- Tests: Whop client is mocked per-file; api-server tests that hit gated endpoints must create users with a far-future `proUntil`.
