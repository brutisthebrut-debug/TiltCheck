---
name: Crew scoping of social surfaces
description: How multi-crew partitions the real world and which helpers gate social data
---

Crews partition the REAL world (demo stays one sealed crew). Two helpers in the api-server scope lib:

- `getSocialUsers(req)` — the only correct user list for social surfaces (leaderboard, head-to-head, workspace members, recap highlights). Demo → whole demo world; real → active-crew members (double-filtered isDemo=false); crewless → self only.
- `userInSocialScope(req, userId)` — crew-aware authorization for any endpoint exposing another bettor's results by userId (e.g. recap, recap narrative).

**Why:** `userInScope` only separates demo vs real worlds. After crews landed, using it to authorize by-userId lookups was a cross-crew privacy leak (caught in review on the recap narrative endpoint).

**How to apply:** any new endpoint that shows other bettors' data must use these helpers, never `userInScope` alone. Multi-user API tests must put their users into one crew (see the putInOneCrew helper pattern in the leaderboard test) or the requester only sees themselves.

Related rules:
- Free cap = 1 crew membership, enforced server-side in the crews routes with per-user advisory lock 429_002 + in-tx re-read; boot bootstrap serialized by lock 429_003. Founder/demo/live proUntil bypass; first membership always free.
- New signups deliberately start crewless (preserves their free slot to join a friend's crew); only the one-time bootstrap migration auto-enrolls.
- Demo crew is isDemo=true; joins filter isDemo=false so its invite code can never link a real account.
- Radix dropdowns in jsdom tests: open via keyDown Enter on the trigger, not click; no jest-dom matchers — use textContent/toBeTruthy.

**Pro-gated routes in scope tests:** /stats/insights runs `requirePro` before any scope check — free test users get 402 regardless of target. To exercise crew-scoping on Pro routes, make the *viewer* a founder (founders pass the Pro gate).
