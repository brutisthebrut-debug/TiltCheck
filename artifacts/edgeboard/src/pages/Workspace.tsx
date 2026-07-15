import { useState } from "react"
import { useUser } from "@/contexts/UserContext"
import {
  useGetWorkspaceLeaderboard,
  getGetWorkspaceLeaderboardQueryKey,
  useCompareWorkspaceMembers,
  getCompareWorkspaceMembersQueryKey,
  useListBets,
  getListBetsQueryKey,
  type LeaderboardEntry,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatOdds, formatDate } from "@/lib/format"
import { Trophy, Flame, Snowflake, Swords, Users, Crown, X } from "lucide-react"
import { QueryErrorCard } from "@/components/QueryErrorCard"

type Period = "week" | "month" | "all"

const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
]

const MISS_REASON_LABELS: Record<string, string> = {
  bad_read: "bad reads",
  bad_price: "bad prices",
  lineup_injury: "injury news",
  emotional: "tilt bets",
  misunderstood_market: "misread markets",
  normal_variance: "plain variance",
}

/** One human line per row: streak, best sport, favorite mistake. */
function flavorLine(e: LeaderboardEntry): string {
  const bits: string[] = []
  if (e.currentStreakType === "win" && e.currentStreak >= 2) bits.push(`${e.currentStreak}W heater`)
  else if (e.currentStreakType === "loss" && e.currentStreak >= 2) bits.push(`${e.currentStreak}L skid`)
  if (e.bestSport) bits.push(`best in ${e.bestSport}`)
  if (e.favoriteMistake && MISS_REASON_LABELS[e.favoriteMistake])
    bits.push(`weakness: ${MISS_REASON_LABELS[e.favoriteMistake]}`)
  if (bits.length === 0) {
    if (e.settledCount === 0) return e.inPlayCount > 0 ? "all in play — nothing graded yet" : "hasn't put anything on the record"
    return "quietly grinding"
  }
  return bits.join(" · ")
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="h-8 w-8 shrink-0 rounded-full bg-yellow-500/20 border border-yellow-500 glow-amber flex items-center justify-center">
        <Crown className="h-4 w-4 text-yellow-500 drop-shadow-[0_0_8px_rgba(234,179,8,0.8)]" />
      </span>
    )
  return (
    <span className="h-8 w-8 shrink-0 rounded-full bg-muted/40 border border-border/60 flex items-center justify-center font-mono text-sm font-bold text-muted-foreground">
      {rank}
    </span>
  )
}

export default function Workspace() {
  const { activeUser } = useUser()
  const [period, setPeriod] = useState<Period>("all")
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: board = [], isLoading, isError, refetch, isRefetching } = useGetWorkspaceLeaderboard(
    { period },
    { query: { queryKey: getGetWorkspaceLeaderboardQueryKey({ period }) } },
  )
  const { data: comparisons = [] } = useCompareWorkspaceMembers(
    { period },
    { query: { queryKey: getCompareWorkspaceMembersQueryKey({ period }) } },
  )
  const { data: friendBets = [], isLoading: isFriendBetsLoading } = useListBets(
    { userId: selectedId, limit: 5 },
    { query: { enabled: selectedId != null, queryKey: [...getListBetsQueryKey({ userId: selectedId }), "recent5"] } },
  )

  const me = comparisons.find((c) => c.userId === activeUser?.id)
  const them = comparisons.find((c) => c.userId === selectedId)
  const selectedEntry = board.find((e) => e.userId === selectedId)

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        <QueryErrorCard
          title="The leaderboard didn't load."
          message="Not a bad beat — just a connection problem. Everyone's rank is safe, for better or worse."
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          testId="card-leaderboard-error"
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
        <Card className="animate-pulse bg-muted/50 h-96" />
      </div>
    )
  }

  const hasAnyData = board.some((e) => e.settledCount > 0 || e.inPlayCount > 0)

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
          <p className="text-muted-foreground mt-1">Who's up, who's down, who should stop betting parlays.</p>
        </div>
        <div className="flex rounded-lg border border-border/60 bg-card p-1" role="tablist" aria-label="Time period">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              role="tab"
              aria-selected={period === p.value}
              onClick={() => setPeriod(p.value)}
              data-testid={`tab-period-${p.value}`}
              className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
                period === p.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!hasAnyData ? (
        <Card className="border-dashed border-2 border-muted">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <Users className="h-10 w-10 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Nothing on the board yet</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Once the crew logs and settles bets, the bragging rights get handed out here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Crew Rankings</CardTitle>
            </div>
            <CardDescription>
              Settled results only — pending plays count as "in play", not rank. Tap a friend for the head-to-head.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {board.map((e) => {
              const isYou = e.userId === activeUser?.id
              const isSelected = e.userId === selectedId
              const clickable = !isYou
              return (
                <button
                  key={e.userId}
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && setSelectedId(isSelected ? null : e.userId)}
                  data-testid={`row-leaderboard-${e.userId}`}
                  className={`w-full text-left flex items-center gap-3 rounded-lg border px-3 py-3 transition-all duration-300 ${
                    isSelected
                      ? "border-primary bg-primary/10 glow-primary scale-[1.01]"
                      : "border-border/60 bg-background/60"
                  } ${clickable ? "hover:border-primary/50 cursor-pointer hover:bg-card" : "cursor-default"} ${
                    isYou ? "ring-1 ring-primary/50" : ""
                  }`}
                >
                  <RankBadge rank={e.rank} />
                  <span
                    className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ backgroundColor: e.avatarColor }}
                  >
                    {e.userName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm truncate">{e.userName}</span>
                      {isYou && (
                        <Badge className="text-[9px] px-1.5 py-0 uppercase" variant="outline">You</Badge>
                      )}
                      {e.currentStreakType === "win" && e.currentStreak >= 2 && (
                        <Flame className="h-4 w-4 text-[#ff9900] drop-shadow-[0_0_6px_rgba(255,153,0,0.8)] shrink-0" />
                      )}
                      {e.currentStreakType === "loss" && e.currentStreak >= 2 && (
                        <Snowflake className="h-4 w-4 text-chart-3 drop-shadow-[0_0_6px_hsl(var(--chart-3)/0.8)] shrink-0" />
                      )}
                      {e.badges.length > 0 && (
                        <span className="flex shrink-0 items-center gap-0.5 text-sm leading-none" data-testid={`badges-user-${e.userId}`}>
                          {e.badges.map((b) => (
                            <span key={b.id} title={b.name} aria-label={b.name}>{b.emoji}</span>
                          ))}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{flavorLine(e)}</p>
                  </div>
                  <div className="hidden sm:block text-right shrink-0">
                    <div className="font-mono text-sm font-bold">
                      {e.wins}-{e.losses}{e.pushes > 0 ? `-${e.pushes}` : ""}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Record</div>
                  </div>
                  <div className="text-right shrink-0 w-20">
                    <div
                      className={`font-mono text-sm font-bold ${
                        e.profit > 0 ? "text-chart-1 text-glow-success" : e.profit < 0 ? "text-chart-2 text-glow-destructive" : ""
                      }`}
                    >
                      {e.profit > 0 ? "+" : ""}{formatCurrency(e.profit, false)}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {e.roi > 0 ? "+" : ""}{e.roi.toFixed(1)}% ROI
                    </div>
                  </div>
                  <div className="hidden md:block text-right shrink-0 w-16">
                    <div className="font-mono text-sm">{e.inPlayCount}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">In Play</div>
                  </div>
                </button>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Head-to-head drill-in */}
      {selectedEntry && them && (
        <div className="space-y-4" data-testid="section-head-to-head">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Swords className="h-6 w-6 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
              <h2 className="text-2xl font-bold tracking-tight text-glow-primary">You vs. {them.userName}</h2>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-close-head-to-head"
              aria-label="Close head-to-head"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {me ? (
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center mb-4">
                  {[me, them].map((m, i) => (
                    <div key={m.userId} className={`flex items-center gap-2 min-w-0 ${i === 1 ? "flex-row-reverse" : ""}`}>
                      <span
                        className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white"
                        style={{ backgroundColor: m.avatarColor }}
                      >
                        {m.userName.charAt(0).toUpperCase()}
                      </span>
                      <span className="font-bold text-sm truncate">{i === 0 ? "You" : m.userName}</span>
                    </div>
                  )).flatMap((el, i) =>
                    i === 0
                      ? [el, <span key="vs" className="text-xs font-bold italic text-muted-foreground px-2">VS</span>]
                      : [el],
                  )}
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Net Profit", a: me.totalProfit, b: them.totalProfit, fmt: (v: number) => `${v > 0 ? "+" : ""}${formatCurrency(v, false)}` },
                    { label: "ROI", a: me.roi, b: them.roi, fmt: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%` },
                    { label: "Win Rate", a: me.winRate, b: them.winRate, fmt: (v: number) => `${v.toFixed(1)}%` },
                    { label: "Bankroll", a: me.currentBankroll, b: them.currentBankroll, fmt: (v: number) => formatCurrency(v, false) },
                  ].map((row) => (
                    <div key={row.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md bg-muted/20 px-3 py-2">
                      <span className={`font-mono text-sm font-bold ${row.a > row.b ? "text-primary" : ""}`}>{row.fmt(row.a)}</span>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider text-center w-24">{row.label}</span>
                      <span className={`font-mono text-sm font-bold text-right ${row.b > row.a ? "text-primary" : ""}`}>{row.fmt(row.b)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                Log a bet yourself to unlock the side-by-side.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{them.userName}'s Recent Bets</CardTitle>
              <CardDescription>The last five plays they put on the record.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {isFriendBetsLoading ? (
                <div className="animate-pulse h-24 rounded-md bg-muted/50" />
              ) : friendBets.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-md">
                  No straight bets logged yet.
                </div>
              ) : (
                friendBets.map((bet) => (
                  <div
                    key={bet.id}
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5"
                    data-testid={`row-friend-bet-${bet.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{bet.pick}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {bet.event} · {formatDate(bet.gameDate)} · {formatOdds(bet.odds)} · {formatCurrency(Number(bet.stake), false)}
                      </p>
                    </div>
                    <Badge
                      variant={bet.status === "won" ? "default" : bet.status === "lost" ? "destructive" : "secondary"}
                      className="shrink-0 text-[10px] uppercase"
                    >
                      {bet.status === "pending" ? "in play" : bet.status}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
