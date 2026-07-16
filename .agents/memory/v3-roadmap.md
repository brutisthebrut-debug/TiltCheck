---
name: V3 done-definition
description: Owner's hard rule on V3 completion and where the verified V3 gap list lives.
---

**Rule:** The owner explicitly forbade starting V4 (or any next-phase) work until V3 is verifiably done. V3 status must be judged by *code*, not by project-task states — many open tasks were found already implemented, and some merged features had real gaps.

**Why:** On 2026-07-16 the owner discovered V3-phase follow-ups had drifted ahead while V3 gaps remained, and was upset. A full 4-way code audit was run; results live in `.local/tasks/v3-roadmap-log.md` (Waves A/B = remaining work; "Stale open tasks" section = open tasks already implemented in code).

**How to apply:** Before planning or accepting any new feature work, open `.local/tasks/v3-roadmap-log.md`. If Wave A isn't empty, steer work there first. Keep the log updated (move items to Done with date + one-liner) exactly like the v2 log. The single biggest known gap: `GET /bets?userId=X` is world-scoped, not crew-scoped — cross-crew betting-history privacy (#38).
