import { useEffect, useRef } from "react"
import { useUser } from "@/contexts/UserContext"
import { useProStatus } from "@/hooks/use-pro"
import { UpgradeCard } from "@/components/UpgradeCard"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sparkles, ExternalLink, Crown, Check } from "lucide-react"

const PRO_FEATURES = [
  "Your Leak — the recurring mistake costing you real money",
  "Tilt Check — the session alarm before the spiral gets expensive",
  "Edge Finder — your best lanes by sport, type, odds band, and day",
  "Head-to-head — full crew compare behind the leaderboard",
  "Lessons — patterns pulled from your post-game reviews",
]

export default function Account() {
  const { activeUser } = useUser()
  const { isPro, isProLoading, isProUnknown, isProRefreshing, status, refreshPro } = useProStatus()

  // Landing back from checkout: this refetch is what makes the server verify
  // the payment with Whop — the redirect itself never grants anything.
  const checkedAfterCheckout = useRef(false)
  useEffect(() => {
    if (checkedAfterCheckout.current) return
    if (new URLSearchParams(window.location.search).get("upgraded") === "1") {
      checkedAfterCheckout.current = true
      refreshPro()
    }
  }, [refreshPro])

  if (!activeUser) return null

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="text-muted-foreground mt-1">
          {activeUser.displayName} · @{activeUser.username}
        </p>
      </div>

      {isProLoading ? (
        <Card className="animate-pulse bg-muted/50 h-40" />
      ) : isProUnknown ? (
        <Card className="border-dashed border-muted" data-testid="card-billing-error">
          <CardContent className="flex flex-col items-start gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Couldn't verify your plan — connection hiccup on the billing check. Your subscription hasn't gone anywhere.
            </p>
            <Button variant="outline" size="sm" onClick={() => refreshPro()} disabled={isProRefreshing} data-testid="button-recheck-billing">
              {isProRefreshing ? "Checking..." : "Re-check"}
            </Button>
          </CardContent>
        </Card>
      ) : isPro ? (
        <Card className="border-primary/40 bg-primary/5 glow-primary" data-testid="card-pro-status">
          <CardHeader>
            <div className="flex items-center gap-2">
              {status?.source === "founder" ? (
                <Crown className="h-5 w-5 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
              ) : (
                <Sparkles className="h-5 w-5 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
              )}
              <CardTitle className="text-base">TiltCheck Pro</CardTitle>
              <Badge className="border-primary/50 bg-primary/15 text-primary" variant="outline" data-testid="badge-pro-active">
                Active
              </Badge>
            </div>
            <CardDescription>
              {status?.source === "founder"
                ? "Founder seat — Pro comes with the crown."
                : status?.proUntil
                  ? `Verified through ${new Date(status.proUntil).toLocaleDateString()} — re-checked automatically.`
                  : "Subscription active."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1.5">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {f}
                </li>
              ))}
            </ul>
            {status?.source === "subscription" && (
              <p className="text-sm text-muted-foreground">
                Manage or cancel on{" "}
                <a
                  href="https://whop.com/orders"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                  data-testid="link-manage-subscription"
                >
                  whop.com
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>{" "}
                — log in with the same email you use here.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <UpgradeCard feature="The insight layer" />
          <Card className="bg-card">
            <CardHeader>
              <CardTitle className="text-base">What Pro unlocks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1.5">
                {PRO_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Already paid and not seeing Pro? Payments are verified with Whop server-side.
                </p>
                <Button variant="outline" size="sm" onClick={() => refreshPro()} data-testid="button-recheck-billing">
                  Re-check
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
