---
name: edgeboard-conventions
description: EdgeBoard project conventions that every code change must follow. Use before touching the API server, the edgeboard frontend, the OpenAPI spec, the database schema, or the demo board — covers the spec-first API workflow, demo-world isolation, the electric theme rules, testing gotchas, and workflow restart requirements.
---

# EdgeBoard Conventions

EdgeBoard is a mobile-first sports bet tracker for a friend group. pnpm monorepo:
`artifacts/edgeboard` (React + Vite + wouter + recharts), `artifacts/api-server`
(Express 5), `lib/api-spec` (OpenAPI source of truth), `lib/db` (drizzle schema).

## Spec-first API workflow (never skip)

1. Edit `lib/api-spec/openapi.yaml` ONLY — never hand-edit generated clients
   (`clean: true` wipes hand edits).
2. `pnpm --filter @workspace/api-spec run codegen`
3. On phantom "no exported member" errors: `npx tsc -b lib/api-zod lib/api-client-react`
4. Before codegen, check openapi.yaml for a duplicated tail (parallel task
   merges have corrupted it before — grep for duplicate schema keys).

## API server rules

- **No hot reload.** After any server change, restart the
  `artifacts/api-server: API Server` workflow. Restarting also re-seeds the
  demo world (tests wipe the dev DB).
- Every new endpoint: validate query/body with the generated zod params,
  `requireProfile` for private data, and self-only scoping (403 when a
  `userId` param ≠ session user) or `userScopeCondition(req)`/`userInScope`
  from `src/lib/scope.ts` for crew-visible data. This is what keeps the demo
  world and the real crew isolated — one unscoped query leaks fake bettors
  into real views.
- Rows with American odds between -99 and +99 are corrupt ("dead zone") —
  stats math must skip them via the existing `hasValidOdds` helper.
- Tests: `cd artifacts/api-server && pnpm run test` (vitest + supertest).
  Copy the Clerk mock from an existing test file. Clean up FK children
  (bets/transactions/parlays) before deleting seeded users in `afterAll`.

## Frontend rules

- Electric/neon dark-only theme: cyan primary, wins = `text-chart-1` +
  `text-glow-success`, losses = `text-chart-2` + `text-glow-destructive`;
  glow utilities (`glow-*`, `text-glow-*`, `shimmer`) live in `index.css`.
  The `dark` class belongs on `<html>` (already set) — never on inner divs
  as a fix.
- No emojis in UI; lucide icons with glow classes instead. Keep every
  existing `data-testid`; add them on new interactive/warning elements.
- Copy tone: confident, lightly ball-busting, never preachy
  ("There's a word for that: chasing.").
- Recharts: a numeric `scale="time"` XAxis needs an explicit ~5-value
  `ticks` array or it draws a tick per point (overlaps + dup-key errors).
- API calls go through the generated hooks in `@workspace/api-client-react`;
  invalidate with the generated `get*QueryKey` helpers. Never hardcode
  `/api/...` fetches — the demo board remaps them via `setUrlRewrite`.
- Production build needs `PORT` and `BASE_PATH=/` env vars set.

## Verification

- Clerk CAPTCHA blocks automated sign-up/sign-in. Verify UI via the public
  `/demo` routes (read-only — writes 403 by design) and auth via curl.
- API from shell: `https://$REPLIT_DEV_DOMAIN/api/...` (demo mount:
  `/api/demo/...`).
- After running the API test suite, restart the API workflow before
  screenshotting the demo board (tests wipe the dev DB; boot re-seeds).
