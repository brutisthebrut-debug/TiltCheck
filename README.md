# TiltCheck

TiltCheck is a private-beta sports betting **decision tracker**. It helps bettors record why they placed a wager, compare confidence with outcomes, grade the decision after settlement, and surface repeated leaks that a normal win/loss record hides.

It is **not** a picks app, tout service, or outcome predictor.

## Review the product

- **Live app:** https://betting-insights-danielleemarlin.replit.app
- **No-login demo:** https://betting-insights-danielleemarlin.replit.app/demo
- **Current roadmap:** [ROADMAP.md](./ROADMAP.md)
- **Structured beta review:** [docs/BETA_REVIEW.md](./docs/BETA_REVIEW.md)

For a first look, use the no-login demo. The review path is intentionally centered on the core thesis rather than every available feature.

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

## Beta thesis

The beta is testing one question:

> Does seeing your own betting-decision patterns change how you think before the next wager?

Until real-user evidence answers that question, the project should favor **clarity, reliability, and testability over feature expansion**.

## Current milestone

The current milestone is **Beta hardening + review clarity**.

This pass focuses on:

- making the public demo easier to review without instruction,
- clarifying the product thesis,
- tightening first-impression UX,
- creating a repeatable reviewer script,
- and keeping product decisions documented in GitHub.

See [ROADMAP.md](./ROADMAP.md) for the evidence gate and next milestones.

## Repository structure

This is a pnpm workspace.

- `artifacts/edgeboard` — React + Vite web app
- `artifacts/api-server` — Express API server
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db` — Drizzle/Postgres schema
- `lib/api-client-react` — generated React API client
- `lib/api-zod` — generated validation types

The original Replit operating notes remain in [replit.md](./replit.md), but GitHub is the canonical code and roadmap source of truth.

## Stack

- React
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

## Local commands

```bash
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-server run test
```

API schema/client regeneration:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Product guardrails

- Do not add picks or predictive recommendations.
- Do not expand integrations merely because they are available.
- Do not confuse feature count with beta progress.
- Keep decision quality distinct from wager outcome.
- Preserve the append-only bankroll ledger model.
- Treat real tester behavior as the next source of product scope.

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

**Private beta / market-validation build.** Major feature expansion remains evidence-gated.
