import { useGetUserBadges, getGetUserBadgesQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { formatDate } from "@/lib/format"
import { Trophy, Lock } from "lucide-react"

/**
 * The trophy case: every badge in the book, earned or not. Earned ones glow
 * with their date; locked ones show exactly what it takes — so streaks and
 * badges are browsable ambitions, not just one-off toasts.
 */
export function TrophyCase({ userId }: { userId: number }) {
  const { data: badges = [], isLoading, isError } = useGetUserBadges(userId, {
    query: { enabled: userId > 0, queryKey: getGetUserBadgesQueryKey(userId) },
  })

  // Quietly absent on failure — the leaderboard above is the main event, and
  // the badge fetch has its own retry lifecycle elsewhere.
  if (isError) return null
  if (isLoading) return <Card className="animate-pulse bg-muted/50 h-40" data-testid="trophy-case-loading" />
  if (badges.length === 0) return null

  const earned = badges.filter((b) => b.earnedAt != null)
  const locked = badges.filter((b) => b.earnedAt == null)

  return (
    <Card data-testid="card-trophy-case">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-[#ff9900] drop-shadow-[0_0_8px_rgba(255,153,0,0.8)]" />
          <CardTitle className="text-base">Trophy Case</CardTitle>
        </div>
        <CardDescription>
          {earned.length === 0
            ? `${badges.length} badges up for grabs. Every one has a price — here's the menu.`
            : `${earned.length} of ${badges.length} claimed. The grey ones are still on the table.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {[...earned, ...locked].map((b) => {
          const isEarned = b.earnedAt != null
          return (
            <div
              key={b.id}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-all ${
                isEarned
                  ? "border-[#ff9900]/40 bg-[#ff9900]/5"
                  : "border-border/60 bg-background/40 opacity-60"
              }`}
              data-testid={`badge-${isEarned ? "earned" : "locked"}-${b.id}`}
            >
              <span className={`text-2xl leading-none ${isEarned ? "" : "grayscale"}`} aria-hidden>
                {b.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-bold truncate ${isEarned ? "text-[#ff9900]" : ""}`}>
                    {b.name}
                  </span>
                  {!isEarned && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Locked" />}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{b.description}</p>
                {isEarned && (
                  <p className="text-[10px] uppercase tracking-wider text-[#ff9900]/80 mt-1 font-mono">
                    Earned {formatDate(b.earnedAt!)}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
