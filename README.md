# TiltCheck

TiltCheck is a private-beta sports betting **decision tracker**. It helps bettors record why they placed a wager, compare confidence with outcomes, grade the decision after settlement, and surface repeated leaks that a normal win/loss record hides.

It is **not** a picks app, tout service, sportsbook, or outcome predictor.

## Beta status

**GitHub is the source of truth. The former Replit deployment is retired and is not the canonical build.**

The second pre-review hardening pass is now merged to `main`. TiltCheck no longer requires Replit-specific auth, AI, billing-credential, build, proxy, or deployment behavior. A clean GitHub runner can install from the frozen lockfile, typecheck the workspace, run the frontend test suite, and build the full repo successfully.

The remaining blocker before sharing a review URL is operational: instantiate an independent production environment, configure its secrets/domain, and pass the smoke test in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## Review the product

- **Roadmap:** [ROADMAP.md](./ROADMAP.md)
- **Structured beta review:** [docs/BETA_REVIEW.md](./docs/BETA_REVIEW.md)
- **Deployment / cutover:** [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
- **Reference Render blueprint:** [render.yaml](./render.yaml)
- **Environment template:** [.env.example](./.env.example)

The public `/demo` route is designed as the first-review experience. It uses fictional, read-only data and guides reviewers through the strongest product loop without requiring an account.

## Core loop

1. Log a straight bet or parlay before the event.
2. Record the rationale and a 1–10 conviction score.
3. Settle the play after the result.
4. Grade the decision separately from whether it won.
5. Review calibration, ROI, recurring mistakes, Edge Finder lanes, lessons, and weekly recap.
6. Use the crew board for accountability and comparison without turning the product into a picks feed.

## What already exists

- Straight-bet logging and settlement
- Multi-leg parlay logging and settlement
- Rationale + confidence capture
- Decision-quality grading
- Bankroll ledger and running balance
- ROI / record / confidence calibration
- Leak detection and repeated mistake patterns
- Lessons and Edge Finder views
- Weekly recap with richer historical context
- Crew workspace and challenges
- CSV exports
- Public read-only demo
- Authenticated private-beta experience
- App-level crash recovery screen
- Mobile navigation consolidated around the core loop
- Hosting-neutral Clerk, OpenAI, Whop, CORS, proxy, and server configuration
- Same-origin production serving: one Node service for React + `/api/*`
- GitHub Actions typecheck/test/build gate
- Health endpoint and graceful API shutdown
- Reproducible independent-host reference deployment

## Beta thesis

The beta is testing one question:

> Does seeing your own betting-decision patterns change how you think before the next wager?

The pre-review hardening passes intentionally improved **clarity, reliability, trust, mobile usability, security, and portability** rather than expanding the feature count.

## Current milestone

### Independent beta cutover + reviewer readiness

Engineering hardening is complete. Operational cutover remains.

Definition of done:

- GitHub CI is green. ✅
- Independent deployment blueprint exists. ✅
- Retired host config is removed from the live tree. ✅
- A non-Replit production environment is instantiated from `render.yaml` or an equivalent host configuration.
- Production secrets and founder identity are configured.
- Historical VAPID credentials are not reused; push stays disabled until fresh keys exist.
- `/healthz` returns 200.
- `/demo` works signed out on desktop and mobile.
- Clerk sign-in/sign-up works on the final domain.
- The first structured reviewer can complete the guided path without founder coaching.
- The verified production origin is written back into the roadmap and reviewer handoff.

After that, the roadmap returns to five structured reviews and evidence-gated product decisions.

## Repository structure

This is a pnpm workspace.

- `artifacts/edgeboard` — React + Vite web app
- `artifacts/api-server` — Express API server and production static host
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db` — Drizzle/Postgres schema
- `lib/api-client-react` — generated React API client
- `lib/api-zod` — generated validation types
- `lib/integrations-openai-ai-server` — AI client wrapper
- `docs/` — beta protocol and deployment operating docs
- `render.yaml` — optional Render reference infrastructure

Some unused legacy packages remain in the frozen lockfile until a dedicated dependency-refresh pass. They are not part of the runtime deployment contract and do not block the verified build.

## Stack

- React 19
- Vite
- TypeScript
- Wouter
- TanStack Query
- Clerk authentication
- Express 5
- PostgreSQL
- Drizzle ORM
- Zod
- pnpm workspaces

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/edgeboard run test
pnpm run build
```

The current verified frontend suite contains 180 passing tests.

API integration tests exist, but they intentionally use and mutate a PostgreSQL test database. Run them only against an isolated database:

```bash
pnpm --filter @workspace/api-server run test
```

API schema/client regeneration:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Product guardrails

- Do not add picks or predictive recommendations.
- Do not confuse feature count with beta progress.
- Keep decision quality distinct from wager outcome.
- Preserve the append-only bankroll ledger model.
- Treat real tester behavior as the next source of product scope after cutover.
- Do not couple core product code to a hosting vendor again.

## Engineering guardrails

- Pull requests should pass `.github/workflows/ci.yml`.
- Secrets belong in host secret storage, never Git.
- Production CORS is explicit rather than wildcard-by-default.
- Proxy trust is explicit through `TRUST_PROXY_HOPS`.
- Standard service credentials are read from environment variables.
- The API exposes `/healthz` for deployment health checks.
- The production beta should remain one public origin unless evidence justifies added infrastructure complexity.

## Beta review standard

A sent link is not evidence. A completed review record is evidence.

The first five testers should be able to:

- understand the product in under one minute,
- move through the demo without an account,
- explain the value proposition back in their own words,
- identify the screen they would return to,
- and state whether they would use it with real bets for seven days.

Use [docs/BETA_REVIEW.md](./docs/BETA_REVIEW.md) for the exact session flow.

## Status

**Private beta / independent-host cutover.** Product expansion remains evidence-gated after the cutover is proven.
