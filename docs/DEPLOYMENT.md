# TiltCheck Deployment Guide

TiltCheck is now designed to deploy without relying on a specific app-building or hosting vendor.

## Recommended production shape

Use three managed pieces:

1. **Web** — static output from `artifacts/edgeboard/dist/public`
2. **API** — Node service from `artifacts/api-server/dist/index.mjs`
3. **Database** — managed PostgreSQL

The web and API can share one public domain through a reverse proxy, or live on separate origins. Same-origin is operationally simpler; split-origin is supported with `ALLOWED_ORIGINS`.

## Runtime versions

- Node.js 24
- pnpm 10
- PostgreSQL

GitHub CI uses the same Node/pnpm major versions so a green build is meaningful for deployment.

## Build

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

The root build compiles workspace libraries, the API, and the web app.

### Web-only

```bash
pnpm --filter @workspace/edgeboard run build
```

Output:

```text
artifacts/edgeboard/dist/public
```

`BASE_PATH` is optional and defaults to `/`. Only set it when serving the app under a sub-path.

### API-only

```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

The API defaults to port `8080` when `PORT` is not supplied. Most container platforms inject `PORT` automatically.

## Health check

Point the hosting platform's liveness check at:

```text
GET /healthz
```

Expected response:

```json
{"status":"ok","service":"tiltcheck-api"}
```

This endpoint does not require authentication.

## Required environment

Start from `.env.example`.

### Database

```text
DATABASE_URL
```

A standard PostgreSQL connection URL.

### Clerk

API:

```text
CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

Web build:

```text
VITE_CLERK_PUBLISHABLE_KEY
```

TiltCheck uses standard Clerk configuration. There is no application-level Clerk proxy. Configure the final production domain, OAuth redirect URLs, and allowed origins in Clerk itself.

### OpenAI

```text
OPENAI_API_KEY
```

Optional:

```text
OPENAI_BASE_URL
```

Leave `OPENAI_BASE_URL` unset for the standard OpenAI API. The legacy integration variable names remain accepted temporarily by the client to make migration safer, but new environments should use the standard names.

### Whop

Optional until billing is enabled:

```text
WHOP_API_KEY
```

Billing no longer obtains credentials through a host connector.

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

### CORS

For a same-origin web/API deployment, leave this blank:

```text
ALLOWED_ORIGINS=
```

For a split-origin deployment, provide the exact web origins as a comma-separated list:

```text
ALLOWED_ORIGINS=https://app.example.com,https://preview.example.com
```

Production does not permit arbitrary cross-origin credentials by default.

### Beta seat ceiling

```text
BETA_SEAT_LIMIT=0
```

`0` means unlimited. A positive integer reinstates the seat ceiling.

### Push notifications

Optional:

```text
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

Without VAPID keys, push delivery stays disabled while the worker can still perform its non-push scheduled work.

## Database schema

Before pointing production traffic at a fresh database:

```bash
DATABASE_URL=<production-url> pnpm --filter @workspace/db run push
```

Treat this as an explicit deployment step. Do not run `push-force` against production without reviewing the schema diff and understanding destructive changes.

## Static-host routing

The React app uses client-side routing. Configure the static host to rewrite unknown application routes to `index.html` so direct visits such as these do not 404 at the CDN:

```text
/demo
/sign-in
/sign-up
/bets/123
/recap
```

Do **not** rewrite `/api/*` to the web app when the API shares the same public origin.

## API routing

The frontend-generated API client calls `/api/*`. The cleanest deployment is therefore:

```text
/          -> static web
/api/*     -> Node API
/healthz   -> Node API
```

If web and API are deployed to separate origins, the API client base URL will need to be made explicit before cutover. Prefer same-origin for the first independent beta deployment unless there is a strong reason not to.

## Clerk cutover checklist

Before sending the new hosted URL to testers:

- Create/confirm the production Clerk application.
- Add the final web domain.
- Configure Google/OAuth providers as needed.
- Add sign-in/sign-up redirect URLs for the final domain.
- Set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` on the API service.
- Set `VITE_CLERK_PUBLISHABLE_KEY` at web build time.
- Verify sign-in, sign-out, and `/join/:code` from a private browser window.

## Release gate

A deployment candidate should not be promoted merely because the host says the deploy succeeded.

Minimum smoke test:

1. `/healthz` returns 200.
2. Landing page loads from a clean browser.
3. `/demo` works without sign-in.
4. Demo Dashboard → Stats → Lessons → Recap → Crew path works.
5. Privacy and Terms load directly by URL.
6. Sign-up renders without console/auth origin errors.
7. Existing user sign-in works.
8. A test user can log a bet, settle it, and see the resulting stats update.
9. Mobile bottom navigation exposes the core four destinations plus More.
10. Server restart does not lose persisted data.

## CI

`.github/workflows/ci.yml` runs on pull requests and `main` pushes:

- frozen-lockfile install
- workspace typecheck
- web unit tests
- full workspace build

The current API integration suite is intentionally not in the default CI job because it is destructive by design and expects a dedicated PostgreSQL database. Before enabling it in CI, provision an isolated ephemeral database and apply the schema within that job.

## Host selection

Do not change product architecture just to accommodate a hosting vendor. A suitable host needs to support:

- Node 24 or a standard Node container
- environment secrets
- a health check
- managed PostgreSQL or connectivity to one
- static web hosting or a reverse proxy to the built web output
- custom domains + TLS

Choose the cheapest boring option that satisfies those requirements for beta. The product should remain portable.
