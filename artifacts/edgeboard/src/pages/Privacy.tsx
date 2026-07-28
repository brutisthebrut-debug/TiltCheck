import { Link } from "wouter"
import { ArrowLeft } from "lucide-react"
import { ResponsibleGamblingNote } from "@/components/TrustFooter"

/**
 * Privacy page — public (linked from sign-up and the account page). Plain
 * language in the app's voice: what's stored, what's never done with it.
 */
export default function Privacy() {
  return (
    <div className="dark min-h-[100dvh] bg-background font-mono text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-12 space-y-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          data-testid="link-back-home"
        >
          <ArrowLeft className="h-4 w-4" /> TiltCheck
        </Link>

        <div>
          <h1 className="text-3xl font-bold tracking-tight">Privacy</h1>
          <p className="text-muted-foreground mt-1 text-sm">Last updated July 15, 2026</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">What we store</h2>
            <p>
              The email you sign in with, the display name and avatar color you pick, and the
              betting decisions you log — bets, parlays, stakes, odds, rationales, conviction
              scores, grades, and your bankroll ledger. If you're in a crew, your crewmates see
              your record on the shared boards; your bankroll numbers and bet history details
              stay yours.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">What we never do</h2>
            <p>
              We don't sell your data, share it with sportsbooks, run ads against it, or use it
              for anything other than showing you your own patterns. TiltCheck is a tracker, not
              a sportsbook — no money moves through it, and nothing you log here places a bet
              anywhere.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Who can see what</h2>
            <p>
              Crewmates see the social surfaces: leaderboard standings, head-to-head records,
              badges, and streaks. They never see your starting bankroll, your ledger, or the
              reasoning you write on your bets. People outside your crew see nothing.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Deleting your data</h2>
            <p>
              You can delete your account yourself from the{" "}
              <Link href="/account" className="text-primary underline-offset-2 hover:underline">
                account page
              </Link>
              . It removes everything — profile, bets, parlays, ledger, badges, crew memberships,
              and your sign-in — permanently. Your CSV exports are yours to take first.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Sign-in and payments</h2>
            <p>
              Sign-in is handled by Clerk; paid multi-Crew access is processed by Whop. Each
              sees only what it needs (your email) — your betting data never leaves TiltCheck.
            </p>
          </section>
        </div>

        <div className="border-t border-border pt-6">
          <ResponsibleGamblingNote />
        </div>
      </div>
    </div>
  )
}
