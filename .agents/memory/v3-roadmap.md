---
name: V3 done-definition
description: Owner's hard rule on V3 completion and where the verified V3 gap list lives.
---

**Rule:** The owner explicitly forbade starting V4 (or any next-phase) work until V3 is verifiably done. V3 status must be judged by *code*, not by project-task states — many open tasks were found already implemented, and some merged features had real gaps.

**Why:** On 2026-07-16 the owner discovered V3-phase follow-ups had drifted ahead while V3 gaps remained, and was upset. A full 4-way code audit was run; results live in `.local/tasks/v3-roadmap-log.md` (Waves A/B = remaining work; "Stale open tasks" section = open tasks already implemented in code).

**How to apply:** Before planning or accepting any new feature work, open `.local/tasks/v3-roadmap-log.md`. Wave A (ship blockers) is COMPLETE as of 2026-07-16 — cross-crew read privacy now covers bets, parlays, AND /stats/recent-activity. Wave B code-side items (#21 delete warning, #184 AI fallback, #185 standings proof, #164 badge legibility) are also COMPLETE as of 2026-07-16; the post-publish verifications (#160, #88/#89) were run against the live site on 2026-07-16 after the owner published — all passed. V3 is effectively closed; only the owner's signed-in glance at the founder dashboard remains (automated Clerk sign-in is CAPTCHA-blocked). V4/next-phase work is now unblocked once the owner confirms. Keep the log updated (move items to Done with date + one-liner) exactly like the v2 log. Durable lesson: any endpoint returning another bettor's plays must use the crew-aware social scope, not just world scoping — an audit that checks only the obvious list endpoints will miss feeds like recent-activity.
