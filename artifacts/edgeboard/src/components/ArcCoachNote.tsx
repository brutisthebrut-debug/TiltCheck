/**
 * ArcCoachNote — the "Check with Arc" pre-bet coaching widget.
 *
 * Shows a button once `enabled` is true. On click, fires a POST to
 * /stats/pre-bet-check and renders the 2–3 sentence coaching note inline
 * below the pick field with an Arc indicator and a dismiss button.
 *
 * - Loading: button shows a spinner, cannot be re-clicked
 * - Error: button resets and a one-line "Arc is unavailable" note appears
 *   (never blocks the form — the bet doesn't need Arc's permission)
 * - Note: persists until dismissed or the form resets
 */
import { useState } from "react"
import { usePreBetCheck } from "@workspace/api-client-react"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"

// The Arc glyph — rising arc in SVG
function ArcGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M1 10 Q3 2 6 2 Q9 2 11 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

interface ArcCoachNoteProps {
  /** Show the button once these fields are filled. */
  enabled: boolean
  sport: string
  odds: number
  betType?: string
  stake?: number
  pick?: string
}

export function ArcCoachNote({ enabled, sport, odds, betType, stake, pick }: ArcCoachNoteProps) {
  const [note, setNote] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  const check = usePreBetCheck({
    mutation: {
      onSuccess: (data) => {
        setNote(data.note)
        setDismissed(false)
        setUnavailable(false)
      },
      onError: () => {
        // Never blocks the form — the button resets and we say why.
        setUnavailable(true)
      },
    },
  })

  // Don't render anything until the button is relevant
  if (!enabled) return null

  return (
    <div className="space-y-2" data-testid="arc-coach-section">
      {/* The button — only shows when no note is visible */}
      {(!note || dismissed) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={check.isPending}
          onClick={() => {
            setNote(null)
            setDismissed(false)
            setUnavailable(false)
            check.mutate({
              data: {
                sport,
                odds,
                betType: betType ?? undefined,
                stake: stake ?? undefined,
                pick: pick ?? undefined,
              },
            })
          }}
          data-testid="button-arc-coach-check"
          className="flex items-center gap-1.5 border-primary/30 text-primary hover:border-primary/60 hover:bg-primary/5"
        >
          {check.isPending ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              Arc is reading your tape…
            </>
          ) : (
            <>
              <ArcGlyph className="text-primary" />
              Check with Arc
            </>
          )}
        </Button>
      )}

      {/* Provider down or slow — say so instead of silently resetting.
          Informational only; the bet form stays fully usable. */}
      {unavailable && (!note || dismissed) && (
        <p className="text-xs text-muted-foreground" role="status" data-testid="text-arc-coach-unavailable">
          Arc is taking a breather — your bet doesn't need permission. Try again in a moment.
        </p>
      )}

      {/* The coaching note */}
      {note && !dismissed && (
        <div
          className="flex items-start gap-2.5 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground"
          data-testid="arc-coach-note"
          role="status"
        >
          <ArcGlyph className="mt-0.5 shrink-0 text-primary" />
          <span className="flex-1 leading-relaxed">{note}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 -mr-1 -mt-0.5 shrink-0 text-muted-foreground hover:text-foreground hover:bg-primary/10"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss Arc note"
            data-testid="button-arc-coach-dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
