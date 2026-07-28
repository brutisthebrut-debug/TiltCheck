# TiltCheck beta runbook

## 1. Create independent infrastructure

1. Create a Railway project from the GitHub repository.
2. Add a PostgreSQL service in the same project.
3. Set the app service's `DATABASE_URL` to the PostgreSQL service's private
   `DATABASE_URL`.
4. Generate a Railway domain for staging.
5. Keep GitHub auto-deploys limited to the chosen beta branch until staging is
   signed off. Do not connect or deploy through Replit.

## 2. Configure secrets

Import the variable names from `.env.example`, then set real values in
Railway. Seal server-only secrets where practical.

Required:

- `APP_ORIGIN`
- `DATABASE_URL`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `FOUNDER_EMAIL`

Required for paid second-Crew testing:

- `WHOP_API_KEY`
- `WHOP_COMPANY_ID`
- `WHOP_PLAN_ID`

Optional:

- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Generate a new VAPID keypair. Do not reuse the pair from the old public
Replit configuration.

## 3. Configure providers

### Clerk

Create or select a Clerk application that Daniel controls directly. Add the
staging and production domains to Clerk's allowed origins and redirect URLs.
Do not reuse a platform-managed proxy configuration.

### Whop

Create an API key with the narrowest permissions needed to create checkout
configurations and verify memberships. Confirm the plan represents access to
second and additional Crew memberships—not the personal decision engine.

## 4. Staging smoke test

Run these in order:

1. Public landing page and demo load signed out.
2. Invite link survives sign-up and joins the intended Crew.
3. A new bettor logs a straight bet with an intentional confidence score and
   rationale.
4. The bettor settles and reviews the bet.
5. Reopening, correcting, and deleting the settled bet leave bankroll history
   correct.
6. A parlay can be logged, settled, reviewed, and corrected.
7. Crew leaderboard, comparison, challenge, and weekly recap remain scoped to
   the active Crew.
8. The first Crew is free.
9. Creating or joining a second Crew opens Whop checkout and never grants
   access from the return URL alone.
10. Account deletion removes the bettor's private records and handles Crew
    ownership safely.
11. Repeat the log and settlement loop at phone width.

## 5. Five-tester evidence gate

Do not expand features until five real testers complete observed sessions.
For each tester, record:

- first bet logged
- first bet settled and reviewed
- second bet logged within seven days
- Crew invite sent or accepted
- decision feedback understood without founder explanation
- any attempted second-Crew conversion

The beta decision is based on repeat behavior and Crew pull—not account count.

The founder-only Beta Ops page automatically tracks the first play, first
process review, seven-day return, and Crew membership. Record comprehension,
invite behavior, and second-Crew intent during the observed session.
