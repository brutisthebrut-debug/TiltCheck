import { Link } from "wouter"
import { ArrowLeft } from "lucide-react"
import { ResponsibleGamblingNote } from "@/components/TrustFooter"

/**
 * Terms page — public (linked from sign-up and the account page). Short and
 * honest: what TiltCheck is, what it isn't, and the ground rules.
 */
export default function Terms() {
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
          <h1 className="text-3xl font-bold tracking-tight">Terms</h1>
          <p className="text-muted-foreground mt-1 text-sm">Last updated July 15, 2026</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">What TiltCheck is</h2>
            <p>
              A decision tracker for sports bettors. You log bets you've placed elsewhere, grade
              your own reasoning, and see your patterns. That's it.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">What TiltCheck is not</h2>
            <p>
              Not a sportsbook, not a betting exchange, not a tout service. No bets are placed
              here, no gambling money is held here, and nothing in the app — including the
              insights — is betting advice. Your bankroll figures are numbers you type in, not
              funds we hold.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Ground rules</h2>
            <p>
              You must be of legal gambling age where you live to use TiltCheck. One account per
              person. Don't log other people's data, and keep crew invite codes to people you
              actually know.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Your data, your call</h2>
            <p>
              Your entries are yours. Export them as CSV anytime, and delete your account —
              and everything with it — from the{" "}
              <Link href="/account" className="text-primary underline-offset-2 hover:underline">
                account page
              </Link>{" "}
              whenever you want. See the{" "}
              <Link href="/privacy" className="text-primary underline-offset-2 hover:underline">
                privacy policy
              </Link>{" "}
              for the details.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">The honest fine print</h2>
            <p>
              TiltCheck is a small product in active beta. It's provided as-is: stats can have
              bugs, features can change, and the service could shut down (with notice and time
              to export your data). Multi-Crew access is billed through Whop and can be
              cancelled there anytime.
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
