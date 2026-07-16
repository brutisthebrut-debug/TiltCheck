import { useEffect, useRef, useState } from "react"
import { Link } from "wouter"
import { useClerk } from "@clerk/react"
import { useUser } from "@/contexts/UserContext"
import { useProStatus } from "@/hooks/use-pro"
import { UpgradeCard } from "@/components/UpgradeCard"
import { ResponsibleGamblingNote } from "@/components/TrustFooter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useDeleteCurrentUser, useUpdateUser, getGetStatsPeerBenchmarksQueryKey } from "@workspace/api-client-react"
import { getApiErrorMessage } from "@/lib/api-error"
import { Sparkles, ExternalLink, Crown, Check, ShieldCheck, Trash2, Bell, BellOff, BellRing, Users } from "lucide-react"
import { useNotifications } from "@/hooks/useNotifications"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useQueryClient } from "@tanstack/react-query"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

const DELETE_PHRASE = "DELETE"

/** Anonymous peer benchmark opt-out section. */
function BenchmarkPrivacySection() {
  const { activeUser, refreshUser } = useUser()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const updateUser = useUpdateUser()

  if (!activeUser) return null

  const toggle = async (value: boolean) => {
    setSaving(true)
    try {
      await updateUser.mutateAsync({ id: activeUser.id, data: { includedInBenchmarks: value } })
      // Refresh the user context so the toggle reflects immediately
      refreshUser?.()
      // Invalidate peer benchmark cache so the Stats page picks up the change
      queryClient.invalidateQueries({ queryKey: getGetStatsPeerBenchmarksQueryKey() })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card data-testid="card-benchmark-privacy">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          Anonymous Benchmarking
        </CardTitle>
        <CardDescription>
          When enabled, your data is included in the anonymized pool used to compute platform-wide
          percentile rankings. Only percentile bands are exposed — no individual results, no
          identifying information. Opt out any time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="benchmark-opt-in" className="flex flex-col gap-0.5 cursor-pointer">
            <span className="text-sm font-medium">Include my data in anonymous benchmarks</span>
            <span className="text-xs text-muted-foreground font-normal">
              {activeUser.includedInBenchmarks
                ? "Your data is included. You can see where you rank on the Stats page (Pro)."
                : "Opted out. Your data is excluded and benchmarks won't show on Stats."}
            </span>
          </Label>
          <Switch
            id="benchmark-opt-in"
            checked={activeUser.includedInBenchmarks}
            onCheckedChange={toggle}
            disabled={saving}
            data-testid="switch-benchmark-opt-in"
          />
        </div>
      </CardContent>
    </Card>
  )
}

/** Push notification preferences section on the Account page. */
function NotificationsSection() {
  const { supported, permission, subscribed, prefs, loading, requestAndSubscribe, unsubscribe, updatePref } =
    useNotifications()

  if (!supported) {
    return (
      <Card data-testid="card-notifications">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            Notifications
          </CardTitle>
          <CardDescription>
            Push notifications aren't supported in this browser. Try Chrome or Firefox on
            desktop, or your phone's browser.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card data-testid="card-notifications">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              {subscribed ? (
                <BellRing className="h-4 w-4 text-primary" />
              ) : (
                <Bell className="h-4 w-4 text-muted-foreground" />
              )}
              Notifications
            </CardTitle>
            <CardDescription>
              {permission === "denied"
                ? "Notifications are blocked in your browser — open browser settings to allow them for this site."
                : subscribed
                  ? "TiltCheck will nudge you before bad patterns get worse."
                  : "Get nudged before bad patterns get worse. Enable once, works across sessions."}
            </CardDescription>
          </div>
          {permission !== "denied" && (
            <Button
              variant={subscribed ? "outline" : "default"}
              size="sm"
              onClick={subscribed ? unsubscribe : requestAndSubscribe}
              disabled={loading}
              data-testid="button-notifications-toggle"
            >
              {loading ? "…" : subscribed ? (
                <>
                  <BellOff className="h-3.5 w-3.5 mr-1.5" />
                  Turn off
                </>
              ) : (
                <>
                  <Bell className="h-3.5 w-3.5 mr-1.5" />
                  Enable
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      {subscribed && (
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
            What you hear about
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="notify-overdue" className="flex flex-col gap-0.5 cursor-pointer">
                <span className="text-sm font-medium">Overdue bets</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Remind me when a play has been pending over 48 hours
                </span>
              </Label>
              <Switch
                id="notify-overdue"
                checked={prefs.notifyOverdue}
                onCheckedChange={(v) => updatePref("notifyOverdue", v)}
                data-testid="switch-notify-overdue"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="notify-tilt" className="flex flex-col gap-0.5 cursor-pointer">
                <span className="text-sm font-medium">Tilt alert</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Warn me when my session matches my tilt pattern
                </span>
              </Label>
              <Switch
                id="notify-tilt"
                checked={prefs.notifyTilt}
                onCheckedChange={(v) => updatePref("notifyTilt", v)}
                data-testid="switch-notify-tilt"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="notify-crew" className="flex flex-col gap-0.5 cursor-pointer">
                <span className="text-sm font-medium">Crew activity</span>
                <span className="text-xs text-muted-foreground font-normal">
                  Notify me when a crew member cashes a notable win
                </span>
              </Label>
              <Switch
                id="notify-crew"
                checked={prefs.notifyCrewActivity}
                onCheckedChange={(v) => updatePref("notifyCrewActivity", v)}
                data-testid="switch-notify-crew"
              />
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

/** Typed-confirmation account deletion. Irreversible, so the button stays
 * dead until the user types the phrase; on success the session is ended. */
function DeleteAccountSection() {
  const { signOut } = useClerk()
  const [open, setOpen] = useState(false)
  const [phrase, setPhrase] = useState("")
  const deleteAccount = useDeleteCurrentUser({
    mutation: {
      onSuccess: () => {
        // The server already removed the sign-in account; this clears the
        // local session and lands on the public page.
        signOut({ redirectUrl: basePath || "/" })
      },
    },
  })

  return (
    <Card className="border-destructive/40" data-testid="card-delete-account">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-destructive" />
          Delete my account
        </CardTitle>
        <CardDescription>
          Permanently removes your profile, every bet and parlay you've logged, your bankroll
          ledger, badges, and crew memberships. Crews you own go to their longest-standing
          member — or shut down if you're the only one in them. There's no undo, and no
          30-day grace period: it's gone when you confirm.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) {
              setPhrase("")
              deleteAccount.reset()
            }
          }}
        >
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" data-testid="button-delete-account">
              Delete my account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent data-testid="dialog-delete-account">
            <AlertDialogHeader>
              <AlertDialogTitle>This erases everything. Sure?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>Deleting your account permanently removes:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Your profile and sign-in</li>
                    <li>Every bet, parlay, and rationale you've logged</li>
                    <li>Your bankroll ledger and badges</li>
                    <li>Your spot in every crew — crews you own pass to their longest-standing member, or close if it's just you</li>
                  </ul>
                  <p>
                    Want your history first? Export your CSVs before you do this. Type{" "}
                    <span className="font-bold text-foreground">{DELETE_PHRASE}</span> to confirm.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={DELETE_PHRASE}
              autoComplete="off"
              data-testid="input-delete-confirm"
            />
            {deleteAccount.isError && (
              <p className="text-sm text-destructive" data-testid="text-delete-error">
                {getApiErrorMessage(deleteAccount.error, "Couldn't delete the account — nothing was removed. Try again.")}
              </p>
            )}
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-delete-cancel">
                Keep my account
              </Button>
              <Button
                variant="destructive"
                disabled={phrase !== DELETE_PHRASE || deleteAccount.isPending}
                onClick={() => deleteAccount.mutate()}
                data-testid="button-delete-confirm"
              >
                {deleteAccount.isPending ? "Deleting…" : "Delete everything"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

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

      <Card data-testid="card-trust">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Trust &amp; fair play
          </CardTitle>
          <CardDescription>
            TiltCheck is a tracker, not a sportsbook — your data is yours, and no money moves
            through here. The short versions:{" "}
            <Link href="/privacy" className="text-primary underline-offset-2 hover:underline" data-testid="link-privacy">
              privacy
            </Link>{" "}
            ·{" "}
            <Link href="/terms" className="text-primary underline-offset-2 hover:underline" data-testid="link-terms">
              terms
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsibleGamblingNote />
        </CardContent>
      </Card>

      <BenchmarkPrivacySection />

      <NotificationsSection />

      <DeleteAccountSection />
    </div>
  )
}
