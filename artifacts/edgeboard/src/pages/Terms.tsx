import { Link } from "wouter"
import { ArrowLeft } from "lucide-react"
import { ResponsibleGamblingNote } from "@/components/TrustFooter"

/** Public, plain-language beta terms. */
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
          <p className="text-muted-foreground mt-1 text-sm">Last updated August 8, 2026</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">What TiltCheck is</h2>
            <p>
              A decision tracker for sports bettors. You log wagers placed elsewhere, grade your
              reasoning, and review patterns in your own history and, where enabled, your crew.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">What TiltCheck is not</h2>
            <p>
              TiltCheck is not a sportsbook, betting exchange, or tout service. No wagers are
              placed here, no gambling funds are held here, and product insights — including
              AI-generated reflections — are not promises, predictions, or betting advice. Your
              bankroll figures are tracking data, not funds held by TiltCheck.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Ground rules</h2>
            <p>
              You must meet the legal age and other requirements that apply to you where you live.
              Use your own account, do not submit data you do not have permission to use, and keep
              private crew invite codes with people you intend to invite.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Your data, your call</h2>
            <p>
              Export available data as CSV when you want a copy. You can also use the{" "}
              <Link href="/account" className="text-primary underline-offset-2 hover:underline">
                account page
              </Link>{" "}
              to start the account-deletion flow. See the{" "}
              <Link href="/privacy" className="text-primary underline-offset-2 hover:underline">
                privacy policy
              </Link>{" "}
              for how product data and service providers are handled.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Beta software</h2>
            <p>
              TiltCheck is in active beta and is provided as-is. Stats can contain bugs, features
              can change, and availability is not guaranteed. Do not treat a calculation, alert,
              recap, or AI reflection as a substitute for your own judgment.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">Paid features</h2>
            <p>
              If paid plans are enabled, billing is handled by the payment provider shown during
              checkout. Pricing, renewal, and cancellation terms should be displayed before you
              purchase. The core product should not imply that paying improves betting outcomes.
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
