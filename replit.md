# EdgeBoard

Private-beta sports bet tracker for a small crew: log the reasoning behind every bet, grade decisions after settling, and surface each bettor's most expensive habits.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (build + start; **no hot reload — restart the workflow after server changes**)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only; production schema is applied automatically by the Publish flow)
- `pnpm --filter @workspace/api-server run test` — API integration tests (supertest + mocked Clerk)
- Required env: `DATABASE_URL` — Postgres connection string (runtime-managed)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (wouter router), Clerk auth (Replit-managed)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — **source of truth for the API contract.** Edit here, then run codegen; never hand-edit `lib/api-zod` or `lib/api-client-react/src/generated`.
- `lib/db` — Drizzle schema (source of truth for tables)
- `artifacts/api-server/src/routes` — Express routes (all `/api/*` behind Clerk auth)
- `artifacts/edgeboard/src` — web app (pages, components, hooks)

## Architecture decisions

- Transactions ledger is append-only: `balanceAfter` is a point-in-time snapshot, never rewritten. Deleting a settled bet/parlay appends a compensating `adjustment` row, so `balanceAfter[n] = balanceAfter[n-1] + amount[n]` holds for rows ordered by `(createdAt, id)`, and summing `amount` always agrees with the latest `balanceAfter`. Balance-over-time displays can use `balanceAfter` row by row. (Documented on the `transactions` schema.)
- Seat cap: `POST /users/claim` counts linked profiles under a Postgres advisory lock; the cap is read at request time from `BETA_SEAT_LIMIT` (default `0` = unlimited since V2 opened the board to everyone with the link). Set any positive number to reinstate a ceiling — no rebuild needed.
- CSV exports (`/api/export/*.csv`) treat header column order as a contract — append new columns, never reorder.

## Production configuration

- Published at `https://betting-insights-danielleemarlin.replit.app` (autoscale, public).
- Auth: Replit-managed Clerk. Dev uses `pk_test`/`sk_test` keys (dev-key console warnings in the workspace are expected); Replit swaps to live `pk_live`/`sk_live` keys automatically on publish — never hand-edit the Clerk secrets.
- `BETA_SEAT_LIMIT` is **unset** everywhere (V2: unlimited seats — anyone with the link can join). Set a positive number in the production environment to reinstate a cap.
- Production DB schema is migrated by the Publish flow (dev→prod diff); never write manual prod migrations.

## Product

- Log straight bets and multi-leg parlays with rationale + 1–10 conviction score; settle with reasoning grades
- Bankroll ledger (deposits/withdrawals/adjustments) with running balance
- Stats: ROI, record, confidence-vs-results, leak detection; shared workspace board across the crew
- Needs-settling nudges on the dashboard; CSV export of bets, parlays (one row per leg), and bankroll
- Private crew space: unlimited seats, claim-a-profile flow on first sign-in, invite-link card on the dashboard

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- API dev workflow has no hot reload — restart "artifacts/api-server: API Server" after server changes (port 8080; if EADDRINUSE: `fuser -k 8080/tcp`).
- Clerk CAPTCHA blocks automated sign-up, so e2e tests can only reach the sign-in card; test API behavior server-side with supertest + mocked `@clerk/express`.
- Check `lib/api-spec/openapi.yaml` for a duplicated tail before codegen (can appear after parallel task merges).
- Phantom "no exported member" errors for `@workspace` libs → stale dist; run `tsc -b lib/api-zod lib/api-client-react`.
- Tests run with `fileParallelism:false` and `BETA_SEAT_LIMIT="0"`; clean up test users in `afterAll` and call `pool.end()`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
