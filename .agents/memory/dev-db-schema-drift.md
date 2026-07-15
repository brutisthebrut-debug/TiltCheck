---
name: Dev DB schema drift
description: What to do when api-server tests fail with "column ... does not exist"
---

The drizzle schema in `lib/db` can be ahead of the dev database (e.g. a merged
task added a column but its push never ran in this environment). Symptom: the
entire api-server test suite fails on user/bet inserts with Postgres 42703
"column ... of relation ... does not exist".

**Why:** schema pushes are environment-local; merging code does not migrate the dev DB.

**How to apply:** run `pnpm --filter @workspace/db run push` before assuming a
test failure is caused by your change, whenever the error is a missing column/relation.
