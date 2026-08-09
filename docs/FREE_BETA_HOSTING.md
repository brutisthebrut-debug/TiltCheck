# Free Beta Hosting

TiltCheck's default Render Blueprint is intentionally configured for **$0 infrastructure** during the first reviewer round.

## Why

The product has not yet earned paid infrastructure. The first goal is to get Matt and the first structured testers through the product, capture evidence, and decide whether repeated use justifies ongoing hosting cost.

## What the free Render environment includes

- Free Node web service
- Free Render Postgres database
- Same-origin TiltCheck web + API
- GitHub-triggered deployments
- Health checks
- Clerk/OpenAI secrets supplied through Render, never Git

## Expected limitations

- The free web service can spin down after 15 minutes without traffic. The first request after idle can take roughly a minute while it wakes.
- The free Postgres database is limited to 1 GB and expires after 30 days.
- Free Postgres has no backups or managed connection pooling.
- Push notifications remain disabled until fresh VAPID keys are generated.

These limitations are acceptable for the first evidence round. They are not the intended long-term production architecture.

## Schema setup on free Render

Render's pre-deploy command is a paid web-service feature. The free Blueprint therefore runs the idempotent Drizzle schema push immediately before starting the API:

```text
pnpm --filter @workspace/db run push && pnpm --filter @workspace/api-server run start
```

This keeps the reviewer environment deployable without paying for the pre-deploy feature.

## Upgrade gate

Do not upgrade hosting merely to remove the free-tier limitations. Upgrade or migrate when at least one of these is true:

- structured reviewers demonstrate repeated use,
- the 30-day database window would interrupt an active behavior test,
- cold-start delay materially harms testing,
- or real users are entrusting TiltCheck with data worth retaining beyond the experiment.

Until then, keep the infrastructure cheap and the evidence bar high.
