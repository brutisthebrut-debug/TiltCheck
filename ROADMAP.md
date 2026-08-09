# TiltCheck Roadmap

**Status:** Private beta / market-validation build  
**Updated:** August 8, 2026  
**Code source of truth:** GitHub (`main`)  
**Public review build:** https://betting-insights-danielleemarlin.replit.app  
**No-login demo:** https://betting-insights-danielleemarlin.replit.app/demo

## Product north star

TiltCheck is a decision mirror for sports bettors. The product is not trying to predict winners or sell picks. It records the reasoning behind a wager, compares confidence with results, grades the decision after settlement, and surfaces repeated leaks that normal win/loss tracking hides.

The core question for beta is simple:

> Does seeing your own betting-decision patterns change how you think before the next wager?

## Operating guardrails

1. **Do not reopen the feature firehose.** The product already has enough surface area to test the thesis.
2. **Integrations are not the milestone.** Missing external connections can stay parked unless a tester proves one blocks the core loop.
3. **Polish before expansion.** Improve clarity, reliability, first-run comprehension, and the public demo before adding new systems.
4. **Evidence beats preference.** New work after this pass should trace to observed tester behavior, repeated confusion, commitment, or willingness to pay.
5. **GitHub is canonical.** Roadmap, product notes, and code decisions should live with the repository.

## Current product loop

1. Log a straight bet or parlay **before** the event.
2. Record rationale and a 1–10 confidence score.
3. Settle the play after the result.
4. Grade the quality of the decision separately from the outcome.
5. Review personal stats, calibration, leaks, lessons, and the weekly recap.
6. Compare patterns with a crew without turning TiltCheck into a tout/picks product.

## Milestone B0 — Repository + beta foundation

**State:** Complete

- Full Replit project moved into GitHub.
- Existing production architecture preserved.
- Public demo route available without authentication.
- Core betting, parlay, bankroll, stats, lessons, Edge Finder, recap, and crew surfaces already exist.

**Definition of done:** GitHub contains the working source and the public demo remains the reference experience.

## Milestone B1 — Beta hardening + review clarity

**State:** In progress in `beta-hardening-2026-08-08`

This is the requested ~50% enhancement pass. “50%” means a material improvement in how understandable and testable the existing product feels, not 50% more features.

### Scope

- Make the no-login demo self-guided for a first-time reviewer.
- Give reviewers a recommended sequence through the most important product surfaces.
- Make the product thesis explicit: decision quality over picks.
- Tighten public-facing beta language and metadata.
- Add a repeatable reviewer script and evidence log format.
- Refresh repository documentation so future work does not drift from the thesis.

### Explicitly out of scope

- New sportsbook/data integrations.
- Replatforming or architecture rewrites.
- Broad new social systems.
- New predictive/picks functionality.
- Monetization complexity before evidence.

**Definition of done:** A new person can open `/demo`, understand the thesis in under a minute, follow the key product loop without an account, and give structured feedback.

## Milestone B2 — First five structured testers

**State:** Next

Recruit five bettors who actually place wagers with enough frequency to have habits worth observing.

Each tester should:

- Open the no-login demo first.
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

- Tester / date
- Betting frequency
- First impression in one sentence
- Product explanation in their own words
- Most valuable screen
- Most confusing screen
- Trust concern
- Would use for 7 days? Why/why not?
- Commitment signal: none / account / real logging / invite / pay
- Top observed friction
- Build implication (if any)

## Next decision

Do **not** ask “what should we build next?” until B2 has five completed reviews. Ask:

> What repeated behavior or friction did the five testers actually show us?
