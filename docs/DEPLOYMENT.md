# TiltCheck Deployment Guide

TiltCheck is designed to deploy without relying on a specific app-building or hosting vendor.

## Recommended beta architecture

Keep beta boring:

1. **One Node web service** — Express serves both `/api/*` and the built React app.
2. **One managed PostgreSQL database** — private network access from the app service.

The root build creates both production artifacts:

- API: `artifacts/api-server/dist/index.mjs`
- Web: `artifacts/edgeboard/dist/public`

When `NODE_ENV=production`, the API service serves the built frontend itself and falls back to `index.html` for client-side routes. That gives TiltCheck one origin, one custom domain, one Clerk domain configuration, and no production CORS requirement for the normal beta deployment.

Production routing is therefore:

```text
/          -> built React app / SPA fallback
/api/*     -> Express API
/healthz   -> Express liveness endpoint
```

A split frontend/API deployment remains possible later, but it is unnecessary complexity for the first independent beta.

## Reference deployment: Render

`render.yaml` is checked into the repository as a reproducible **reference implementation**, not as an application dependency.

The blueprint describes:

- one Starter Node web service,
- one Basic PostgreSQL database,
- frozen-lockfile build,
- schema push as a pre-deploy step,
- `/healthz` health checks,
- deploys gated on GitHub checks,
- trusted proxy configuration,
- private database networking,
- secrets entered in the Render dashboard rather than committed to Git.

If another host becomes cheaper or more useful later, the product code should not need to change. The host only needs to satisfy the deployment contract in this document.

## Security gate before first independent deploy

A legacy host configuration committed earlier in the repository lifecycle contained a VAPID private key. That file has been removed from the current tree, but Git history must be treated as public and permanent.

Before enabling push notifications on any new deployment:

1. **Do not reuse any historical VAPID values.**
2. Generate a brand-new VAPID public/private key pair.
3. Store the new private key only in the hosting provider's secret store.
4. Set the new public key in the production environment.
5. Expect existing browser push subscriptions tied to the old key to need re-subscription.

Push notifications should remain disabled until this rotation is complete. This does not block the core beta product.

## Runtime versions

- Node.js 24 (`.node-version` pins the repository runtime)
- pnpm 10
- PostgreSQL

GitHub CI uses the same Node/pnpm major versions so a green build is meaningful for deployment.

## Build and start

From repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/edgeboard run test
pnpm run build
```

Start production with:

```bash
NODE_ENV=production pnpm --filter @workspace/api-server run start
```

The API defaults to port `8080` when `PORT` is not supplied. Managed hosts commonly inject `PORT` automatically.

## Health check

Point the hosting platform's liveness check at:

```text
GET /healthz
```

Expected response:

```json
{"status":"ok","service":"tiltcheck-api"}
```

This endpoint does not require authentication or a bettor profile.

## Required environment

Start from `.env.example`. Real secrets belong in the host secret store, never Git.

### Database

```text
DATABASE_URL
```

Use a standard PostgreSQL connection URL. Prefer the host's private/internal connection string when the app and database share a private network.

### Founder identity

```text
FOUNDER_EMAIL
```

**Set this in production.** Without it, the first account linked on a fresh database becomes the founder. That fallback is useful in development but is not an acceptable production ownership rule.

### Clerk

API runtime:

```text
CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

Web build:

```text
VITE_CLERK_PUBLISHABLE_KEY
```

TiltCheck uses standard Clerk configuration. There is no application-level Clerk proxy. Configure the final production domain, OAuth redirect URLs, and allowed origins in Clerk itself.

Because beta uses one public TiltCheck origin, sign-in, sign-up, `/join/:code`, the app, and the API all stay on the same domain.

### OpenAI

```text
OPENAI_API_KEY
```

Optional for OpenAI-compatible gateways:

```text
OPENAI_BASE_URL
```

Leave `OPENAI_BASE_URL` unset for the standard OpenAI API. Legacy integration variable names remain accepted temporarily by the client to make migration safer, but new environments should use the standard names.

### Whop billing

Billing can remain disabled for reviewer beta. To enable it later:

```text
WHOP_API_KEY
WHOP_COMPANY_ID
WHOP_PLAN_ID
```

The application no longer obtains Whop credentials through a hosting connector.

### Beta access controls

```text
BETA_SEAT_LIMIT=0
BETA_ALLOWED_EMAILS=
```

- `BETA_SEAT_LIMIT=0` means unlimited seats.
- A positive seat limit reinstates a ceiling.
- `BETA_ALLOWED_EMAILS` is an optional comma-separated allowlist.
- Founder-managed database invites remain another supported gate.

### Reverse proxy

```text
TRUST_PROXY_HOPS
```

Default: `0`.

If the API is behind one trusted reverse proxy or load balancer, set:

```text
TRUST_PROXY_HOPS=1
```

Do not blindly increase this value. Client-IP based rate limiting depends on the trusted proxy boundary being correct.

The included Render blueprint sets this to `1`.

### CORS

The recommended single-origin beta deployment needs no cross-origin access, so leave this blank:

```text
ALLOWED_ORIGINS=
```

Only if web and API are deliberately split later should you provide exact web origins:

```text
ALLOWED_ORIGINS=https://app.example.com,https://preview.example.com
```

Production does not permit arbitrary credentialed cross-origin access by default.

### Push notifications

Push is optional and should remain disabled until the historical key rotation is complete:

```text
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

Use only a freshly generated key pair for the independent deployment. Without VAPID keys, push delivery stays disabled while the worker can still perform its non-push scheduled work.

## Database schema

Before routing production traffic to a fresh database:

```bash
DATABASE_URL=<production-url> pnpm --filter @workspace/db run push
```

The included Render blueprint runs this as its pre-deploy command.

Treat schema changes as an explicit deployment step. Do not run `push-force` against production without reviewing the schema diff and understanding destructive changes.

## GitHub CI gate

`.github/workflows/ci.yml` runs on pull requests and `main` pushes:

- frozen-lockfile install,
- workspace typecheck,
- web unit tests,
- full workspace build.

The API integration suite is intentionally not part of the default job yet because it mutates a PostgreSQL test database. Before enabling it in CI, provision an isolated ephemeral database and apply the schema inside that job.

The first clean-clone CI run already exposed a real repository configuration defect in the scripts package. That is the point of the gate: a migration is not complete merely because the old workspace could build it.

## Clerk cutover checklist

Before sending the new hosted URL to testers:

- Create or confirm the production Clerk application.
- Add the final TiltCheck domain.
- Configure Google/OAuth providers as needed.
- Add sign-in and sign-up redirect URLs for the final domain.
- Set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` on the Node service.
- Set `VITE_CLERK_PUBLISHABLE_KEY` in the build environment.
- Verify sign-in, sign-out, and `/join/:code` from a private browser window.

## First independent deployment checklist

1. Merge only a green CI commit to `main`.
2. Create the web service + Postgres database from `render.yaml` or an equivalent host configuration.
3. Enter `FOUNDER_EMAIL`, Clerk keys, and `OPENAI_API_KEY` as host secrets.
4. Leave Whop and VAPID unset for the first reviewer deploy unless intentionally enabling them.
5. Let the pre-deploy schema step finish successfully.
6. Confirm `/healthz` before testing the UI.
7. Configure Clerk for the generated host domain.
8. Run the smoke test below.
9. Only after smoke testing, put the verified origin into `README.md`, `ROADMAP.md`, and the reviewer handoff.

## Release smoke test

A deployment candidate should not be promoted merely because the host says the deploy succeeded.

Minimum smoke test:

1. `/healthz` returns 200.
2. `/` loads the TiltCheck landing page from a clean browser.
3. `/demo` loads directly without sign-in or a server-side 404.
4. Demo Dashboard → Stats → Lessons → Recap → Crew path works.
5. Refreshing a nested SPA route such as `/demo/stats` still loads the app.
6. Privacy and Terms load directly by URL.
7. Sign-up renders without console/auth-origin errors.
8. Existing user sign-in works.
9. A test user can log a bet, settle it, and see the resulting stats update.
10. Mobile bottom navigation exposes Home, Bets, Stats, Recap, and More.
11. More exposes Parlays, Lessons, Edge Finder, Crew, and Bankroll.
12. Server restart does not lose persisted data.
13. API 404s remain JSON/API responses rather than returning the SPA HTML.
14. No retired-host credentials or historical VAPID values exist in the new host environment.
15. Push remains disabled unless a fresh VAPID pair has been generated.

## Host selection rule

Do not change product architecture just to accommodate a hosting vendor. A suitable beta host needs to support:

- a normal Node 24 web process,
- environment secrets,
- a health check,
- managed PostgreSQL or private connectivity to one,
- custom domains + TLS,
- GitHub-triggered deployments.

For the current beta, prefer the cheapest **always-on, boring** option that satisfies those requirements. Free tiers that sleep or expire are useful for smoke tests, not for the link handed to an important reviewer.
