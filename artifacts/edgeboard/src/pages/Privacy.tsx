import { Link } from "wouter"
import { ArrowLeft } from "lucide-react"
import { ResponsibleGamblingNote } from "@/components/TrustFooter"

/**
 * Privacy page — public (linked from sign-up and the account page). Plain
 * language in the app's voice: what's stored, what's shared, what's never done.
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
          <p className="text-muted-foreground mt-1 text-sm">Last updated August 8, 2026</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">What we store</h2>
            <p>
              The email tied to your sign-in, the display name and avatar color you pick, and the
              betting decisions you log — bets, parlays, stakes, odds, rationales, conviction
              scores, grades, and your bankroll ledger. We also store the account and crew data
              needed to run shared boards, recaps, settings, and product features.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">How we use it</h2>
            <p>
              TiltCheck uses your data to calculate your record, ROI, calibration, repeated
              mistakes, recaps, and other decision-tracking views you ask the product to show.
              We do not sell your betting history or use it to place wagers on your behalf.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">AI reflections</h2>
            <p>
              Some features generate written reflections from your TiltCheck history. When you use
              those features, the information needed to generate that reflection can be sent to
              the configured AI provider for processing. TiltCheck is designed to send context for
              the requested feature — not to turn your history into a picks feed or place bets.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Who can see what</h2>
            <p>
              Crewmates can see the social surfaces the product exposes, such as leaderboard
              standings, head-to-head records, badges, streaks, and other crew-level comparisons.
              Your private bankroll ledger and private decision details are not presented as a
              crew feed. People outside your crew do not get access to your private board.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Service providers</h2>
            <p>
              Authentication is handled by Clerk. If paid plans are enabled, billing is handled by
              Whop. AI-powered reflections use the configured AI provider. Those services process
              the information needed to provide their part of the product under their own terms
              and privacy practices.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Deleting your data</h2>
            <p>
              You can delete your account yourself from the{" "}
              <Link href="/account" className="text-primary underline-offset-2 hover:underline">
                account page
              </Link>
              . The deletion flow is intended to remove your TiltCheck profile and associated
              product data. Export any CSVs you want to keep before confirming deletion.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Beta reality</h2>
            <p>
              TiltCheck is in active beta. Data handling and service providers can change as the
              product matures; when that happens, this page should be updated alongside the code
              instead of relying on hidden assumptions.
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
