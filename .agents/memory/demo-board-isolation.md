---
name: Demo board isolation & seeding
description: How the public read-only demo world stays isolated from real data, and how it gets (re)seeded.
---

# Demo board isolation & seeding

**Rule:** Every real-world user query must filter `usersTable.isDemo === false` (helpers: `userScopeCondition(req)` / `userInScope(req, userId)` in the api-server scope lib); any new endpoint accepting an explicit `userId` must return 404 on cross-world access. The demo mount at `/api/demo/*` reuses the real routers behind read-only + demo-session middlewares — never mount admin there.

**Why:** The demo is the real app pointed at a fictional seeded crew. One unscoped query leaks fake bettors into the friend group's views (or real money data to anonymous visitors).

**How to apply:** When adding an API endpoint, add the scope condition to any users/bets/parlays query and a `userInScope` guard for explicit ids; add a cross-scope 404 case to the demo test suite.

**Seeding:** The api-server test suite wipes the dev DB (recap tests `delete(usersTable)` with no filter). The server self-seeds an empty demo world at boot (`ensureDemoSeeded`), so restarting the API workflow restores dev, and prod seeds itself on first boot after publish. Force rebuild (e.g. after seed-logic changes): `pnpm --filter @workspace/scripts run seed-demo-board`.

**Frontend:** The generated API client has a module-global `setUrlRewrite` used by the `/demo` route to remap `/api/*` → `/api/demo/*`; the demo shell uses its own QueryClient so caches never mix. If demo and real views ever render concurrently, replace the global rewrite with an instance-scoped client first.
