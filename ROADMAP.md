# TiltCheck Roadmap

**Status:** Private beta / independent-host cutover  
**Updated:** August 8, 2026  
**Code source of truth:** GitHub (`main`)  
**Public review build:** pending independent deployment  
**No-login demo:** `<production-origin>/demo`

## Product north star

TiltCheck is a decision mirror for sports bettors. The product is not trying to predict winners or sell picks. It records the reasoning behind a wager, compares confidence with results, grades the decision after settlement, and surfaces repeated leaks that normal win/loss tracking hides.

The core question for beta is simple:

> Does seeing your own betting-decision patterns change how you think before the next wager?

## Operating guardrails

1. **Do not reopen the feature firehose.** The product already has enough surface area to test the thesis.
2. **Hosting is infrastructure, not product scope.** Keep the app portable and avoid coupling core behavior to another vendor.
3. **Integrations are not the milestone.** Missing external connections can stay parked unless a tester proves one blocks the core loop.
4. **Polish before expansion.** Improve clarity, reliability, first-run comprehension, mobile usability, trust, and the public demo before adding new systems.
5. **Evidence beats preference.** New product work after cutover should trace to observed tester behavior, repeated confusion, commitment, or willingness to pay.
6. **GitHub is canonical.** Roadmap, product notes, CI, deployment contract, and code decisions live with the repository.

## Current product loop

1. Log a straight bet or parlay **before** the event.
2. Record rationale and a 1–10 confidence score.
3. Settle the play after the result.
4. Grade the quality of the decision separately from the outcome.
5. Review personal stats, calibration, leaks, lessons, and the weekly recap.
6. Compare patterns with a crew without turning TiltCheck into a tout/picks product.

## Milestone B0 — Repository + beta foundation

**State:** Complete

- Full project source moved into GitHub.
- Public demo route exists without authentication.
- Core betting, parlay, bankroll, stats, lessons, Edge Finder, recap, and crew surfaces exist.

**Definition of done:** GitHub contains the working source and complete product history.

## Milestone B1 — Beta hardening + review clarity

**State:** Complete

Delivered in the first hardening pass:

- Self-guided no-login demo.
- Recommended reviewer sequence through the strongest product surfaces.
- Clear “decision quality, not picks” product thesis.
- Demo-first public landing page.
- Structured tester script and evidence log.
- Canonical README + roadmap.

**Definition of done:** A new person can understand the thesis and follow the intended review path without founder narration.

## Milestone B1.5 — Independent hosting + cofounder hardening

**State:** In progress

This second pre-review pass exists because the project is leaving Replit entirely. It is not a feature sprint. It is a portability, reliability, trust, and polish sprint before the first important external review.

### Implemented in this pass

- Removed runtime reliance on host-derived Clerk keys and Clerk proxy behavior.
- Standardized API Clerk configuration through environment variables.
- Removed host-connector credential lookup from Whop billing.
- Standardized OpenAI environment variables while keeping migration fallbacks.
- Made Vite build defaults host-neutral.
- Made reverse-proxy trust explicit rather than platform-assumed.
- Made production CORS explicit instead of wildcard credential access.
- Added `/healthz` for load balancers and host health checks.
- Added graceful API shutdown for rolling deploys.
- Added `.env` secret protection and `.env.example`.
- Added GitHub CI for frozen install, typecheck, web tests, and full build.
- Consolidated the nine-item mobile bottom bar into four core destinations + More.
- Added an app-level recovery screen instead of a blank-page failure.
- Corrected privacy language around AI/service-provider processing.
- Updated the responsible-gambling support resource.
- Added a platform-neutral deployment and smoke-test contract.

### Remaining definition of done

- CI passes on the hardening PR.
- Choose and configure the independent beta host.
- Apply the production DB schema.
- Configure Clerk for the final domain.
- Run the deployment smoke test in `docs/DEPLOYMENT.md`.
- Replace `<production-origin>` with the verified review URL.

### Explicitly out of scope

- New sportsbook/data integrations.
- Predictive picks or recommendations.
- Major social feature expansion.
- Rewriting working domain logic merely to make the repo look cleaner.
- Monetization expansion before real use evidence.

## Milestone B2 — First five structured testers

**State:** Blocked on B1.5 cutover

Recruit five bettors who actually place wagers with enough frequency to have habits worth observing.

Each tester should:

- Open the independently hosted no-login demo first.
- Follow the review path in `docs/BETA_REVIEW.md`.
- Explain the product back in their own words.
- Identify the one screen they would return to most.
- Identify anything confusing, redundant, or untrustworthy.
- Say whether they would log real bets for seven days.
- State whether they would pay, commit, invite a friend, or do none of those things.

**Evidence requirement:** five completed review records, not five sent links.

## Milestone B3 — Seven-day behavior test

**State:** Blocked on B2

Give the strongest-fit testers access to the real product for one week.

Measure:

- Bets/parlays logged before start time.
- Settlement completion.
- Reasoning grades completed.
- Return visits to Stats / Lessons / Recap.
- Crew use if naturally relevant.
- Qualitative examples where TiltCheck changed or challenged a decision.

**Definition of done:** enough observed behavior to distinguish curiosity from repeated value.

## Milestone B4 — Decision gate

After B2/B3, choose one:

### CONTINUE
Use when testers repeatedly complete the loop and describe a clear return reason. Build only the highest-frequency friction or value request.

### NARROW
Use when one slice (for example recap, leak detection, or pre-bet reflection) creates most of the value. Reduce the product around that behavior.

### PARK
Use when people like the concept but will not log bets, return, commit, or pay. Preserve the code and stop polishing.

## Candidate work only after evidence

These are intentionally **not commitments**:

- Faster bet entry if logging friction is the dominant blocker.
- Smarter import/integration paths if manual entry is proven to kill retention.
- Stronger crew mechanics if accountability drives repeated use.
- Paid plan packaging if users demonstrate ongoing value first.
- Mobile-native work only if browser usage is a repeated barrier.

## Evidence log template

For every structured session capture:

- Tester / date / device
- Betting frequency
- First impression in one sentence
- Product explanation in their own words
- Most valuable screen
- Most confusing screen
- Trust concern
- Mobile navigation friction (if applicable)
- Would use for 7 days? Why/why not?
- Commitment signal: none / account / real logging / invite / pay
- Top observed friction
- Build implication (if any)

## Next decision

The immediate decision is operational, not product scope:

> Which boring independent host gives us the cheapest reliable beta deployment without forcing product code to change?

After cutover, return to the evidence gate:

> What repeated behavior or friction did the five testers actually show us?
