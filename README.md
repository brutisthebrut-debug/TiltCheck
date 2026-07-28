# TiltCheck

TiltCheck turns betting history into decision intelligence. Bettors log the
play, confidence, and reasoning; grade the process after settlement; learn
their patterns; and use a private Crew for accountability.

The application is a portable pnpm monorepo:

- React + Vite web app in `artifacts/edgeboard`
- Express API in `artifacts/api-server`
- PostgreSQL + Drizzle schema in `lib/db`
- Clerk authentication
- Whop checkout for second and additional Crew memberships
- Optional OpenAI coaching and weekly narratives

## Local development

Requirements:

- Node 22
- pnpm 11
- PostgreSQL

Copy `.env.example` to `.env`, replace the placeholder values, then run:

```bash
pnpm install
pnpm db:push
pnpm dev
```

The web app runs on `http://localhost:5173` and proxies `/api` to the API on
`http://localhost:3000`.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

API integration tests require `DATABASE_URL` to point to a disposable test
database. They truncate and reseed test data.

## Production

`Dockerfile` builds the web app and API into one same-origin service.
`railway.json` configures a Railway deployment with:

- a PostgreSQL schema push before deployment
- `/api/healthz` as the deployment health check
- the platform-provided `PORT`

The container is host-agnostic and can also run on Render, Fly.io, or another
Docker host. See `docs/BETA_RUNBOOK.md` for the production checklist.

## Security

Never commit `.env` files or credentials. The original public Replit
configuration exposed a VAPID private key; that key must be considered
compromised and replaced before push notifications are enabled.
