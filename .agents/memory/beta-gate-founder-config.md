---
name: Beta gate & founder config
description: How EdgeBoard's invite gate and founder assignment are configured via env vars
---

The claim flow's beta gate unions two invite sources: the founder-managed
`invites` table (emails stored lowercased) and the optional
`BETA_ALLOWED_EMAILS` env var (comma-separated, case-insensitive). The gate is
open (anyone can join) only when BOTH are empty. Already-linked accounts are
never affected by the gate.

**Founder assignment:** when `FOUNDER_EMAIL` is set, only the matching email
becomes founder and it always bypasses the gate and seat cap; first-claim
auto-assignment is disabled. When unset, the first account to link becomes
founder. Auth middleware also self-heals: an already-linked account matching
`FOUNDER_EMAIL` is promoted (promote-only, never demoted) on its next request
— covers accounts that claimed before the env var was set.

**The owner signs in with a different address than first assumed** — the
correct one was confirmed by the user on 2026-07-15 and `FOUNDER_EMAIL`
(shared env) points at it; check the env var, not memory, for the value.
Prod schema is synced by the Publish flow automatically — never run DDL
against prod; "prod is missing a table" = ask the user to republish.

**Why:** an architect review flagged that on a fresh production DB with an open
gate, a stranger signing in first would take the founder seat (full admin
visibility). `FOUNDER_EMAIL` closes that window.

**How to apply:** before/at publish time, set `FOUNDER_EMAIL` (production env)
to the owner's sign-in email. `avoid generic zod format:email in openapi.yaml`
— orval emits zod-v4-only `zod.email()` which breaks the zod 3 build; validate
email format in the route instead.
