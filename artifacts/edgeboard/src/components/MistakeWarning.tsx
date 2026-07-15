import { useState } from "react"
import { useGetStatsInsights, getGetStatsInsightsQueryKey } from "@workspace/api-client-react"
import { useUser } from "@/contexts/UserContext"
import { useProStatus } from "@/hooks/use-pro"
import { AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"

// Miss reasons the bettor could actually have avoided. Normal variance and
// lineup/injury news are the game's fault, not theirs — no warning for those.
const CONTROLLABLE_REASONS: Record<string, string> = {
  bad_read: "bad read",
  bad_price: "bad price",
  emotional: "emotional",
  misunderstood_market: "misunderstood market",
}

const MIN_OCCURRENCES = 2

// Session-level dismissal, keyed by reason: closing the banner keeps it away
// for the rest of the session, but a *new* dominant mistake still shows up.
const dismissKey = (reason: string) => `edgeboard:mistake-warning-dismissed:${reason}`

const wasDismissed = (reason: string) => {
  try {
    return sessionStorage.getItem(dismissKey(reason)) === "1"
  } catch {
    return false
  }
}

const rememberDismissed = (reason: string) => {
  try {
    sessionStorage.setItem(dismissKey(reason), "1")
  } catch {
    // Storage unavailable — the in-memory state still hides it for this page.
  }
}

/**
 * The Lessons feed's top signal, surfaced at the moment it matters: right
 * before the next bet gets logged. Shows only when the bettor's dominant
 * miss reason is a controllable one with a real sample behind it.
 * Never blocks the bet. Pro-only: free accounts get no warning, never an error.
 */
export function MistakeWarning() {
  const { activeUser } = useUser()
  const { isPro } = useProStatus()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const { data: insights } = useGetStatsInsights(
    { userId: activeUser?.id },
    { query: { enabled: isPro && !!activeUser?.id, queryKey: getGetStatsInsightsQueryKey({ userId: activeUser?.id }), staleTime: 60_000 } }
  )

  const top = insights?.missReasons?.[0]
  if (!top) return null
  const label = CONTROLLABLE_REASONS[top.reason]
  if (!label) return null
  if (top.count < MIN_OCCURRENCES) return null
  if (dismissed === top.reason || wasDismissed(top.reason)) return null

  const dismiss = () => {
    rememberDismissed(top.reason)
    setDismissed(top.reason)
  }

  return (
    <div
      className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-500"
      data-testid={`warning-mistake-${top.reason}`}
      role="status"
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="flex-1">
        Heads up — {top.count} of your {insights!.lossesWithReason} reviewed losses were marked "{label}".
        Make this one different.
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 -mr-1 -mt-0.5 shrink-0 text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
        onClick={dismiss}
        aria-label="Dismiss warning"
        data-testid="button-dismiss-mistake-warning"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
