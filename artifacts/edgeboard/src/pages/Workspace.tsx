import { useState } from "react"
import { useUser } from "@/contexts/UserContext"
import {
  useGetWorkspaceLeaderboard,
  getGetWorkspaceLeaderboardQueryKey,
  useCompareWorkspaceMembers,
  getCompareWorkspaceMembersQueryKey,
  useListBets,
  getListBetsQueryKey,
  useListParlays,
  getListParlaysQueryKey,
  type LeaderboardEntry,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatOdds, formatDate } from "@/lib/format"
import { Trophy, Flame, Snowflake, Swords, Users, Crown, X, Layers, Link2 } from "lucide-react"
import { QueryErrorCard } from "@/components/QueryErrorCard"
import { TrophyCase } from "@/components/TrophyCase"
import { useCrews, getCrewActionsEnabled } from "@/hooks/use-crews"
import { CrewSwitcher } from "@/components/CrewSwitcher"
import { Button } from "@/components/ui/button"
import { Copy } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { CrewChallengeSection } from "@/components/CrewChallengeSection"

type Period = "week" | "month" | "all"

const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
]

// Two ways to win the board: run the hottest (richest) or make the best
// decisions (sharpest). Profit ranking stays untouched — sharpest is a
// client-side re-sort on the decision-quality numbers the API now returns.
type RankBy = "richest" | "sharpest"

/** Sharpest = calibration first, then post-mortem discipline, then honesty about sound calls. Nulls sink. */
function sharpestSort(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if ((a.settledCount > 0) !== (b.settledCount > 0)) return a.settledCount > 0 ? -1 : 1
  const cal = (e: LeaderboardEntry) => e.calibrationScore ?? -1
  const pm = (e: LeaderboardEntry) => e.postmortemRate ?? -1
  const sr = (e: LeaderboardEntry) => e.soundRate ?? -1
  if (cal(a) !== cal(b)) return cal(b) - cal(a)
  if (pm(a) !== pm(b)) return pm(b) - pm(a)
  return sr(b) - sr(a)
}

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
  const [rankBy, setRankBy] = useState<RankBy>("sharpest")
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: board = [], isLoading, isError, refetch, isRefetching } = useGetWorkspaceLeaderboard(
    { period },
    { query: { queryKey: getGetWorkspaceLeaderboardQueryKey({ period }) } },
  )
  const { data: comparisons = [] } = useCompareWorkspaceMembers(
    { period },
    { query: { enabled: !!activeUser?.id, queryKey: getCompareWorkspaceMembersQueryKey({ period }) } },
  )
  const { data: friendBets = [], isLoading: isFriendBetsLoading } = useListBets(
    { userId: selectedId, limit: 5 },
    { query: { enabled: selectedId != null, queryKey: [...getListBetsQueryKey({ userId: selectedId }), "recent5"] } },
  )
  const { data: friendParlays = [], isLoading: isFriendParlaysLoading } = useListParlays(
    { userId: selectedId, limit: 5 },
    { query: { enabled: selectedId != null, queryKey: [...getListParlaysQueryKey({ userId: selectedId }), "recent5"] } },
  )

  // Head-to-head counts parlays in the numbers, so the recent list shows
  // them too — merged with straight bets, newest first, capped at five.
  const friendPlays = [
    ...friendBets.map((bet) => ({ kind: "bet" as const, createdAt: bet.createdAt, bet })),
    ...friendParlays.map((parlay) => ({ kind: "parlay" as const, createdAt: parlay.createdAt, parlay })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
  const isFriendPlaysLoading = isFriendBetsLoading || isFriendParlaysLoading

  const { crews, activeCrew } = useCrews()
  const crewActionsEnabled = getCrewActionsEnabled()

  // Full one-tap invite link: real origin + base path + /join/CODE. BASE_URL
  // always carries a trailing slash, so trim it before appending the route.
  const inviteLink = activeCrew
    ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/join/${activeCrew.inviteCode}`
    : null

  const copyInviteLink = () => {
    if (!activeCrew || !inviteLink) return
    navigator.clipboard?.writeText(inviteLink).then(
      () => toast({ title: "Invite link copied", description: "One tap and they're in. Send it to whoever's brave enough to be ranked." }),
      () => toast({ title: "Couldn't copy", description: `The link is ${inviteLink} — grab it by hand.`, variant: "destructive" }),
    )
  }

  const copyInviteCode = () => {
    if (!activeCrew) return
    navigator.clipboard?.writeText(activeCrew.inviteCode).then(
      () => toast({ title: "Invite code copied", description: "Send it to whoever's brave enough to be ranked." }),
      () => toast({ title: "Couldn't copy", description: `The code is ${activeCrew.inviteCode} — grab it by hand.`, variant: "destructive" }),
    )
  }

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
          <p className="text-muted-foreground mt-1">
            {activeCrew
              ? <>Who's up, who's down, who should stop betting parlays — <span className="text-foreground font-medium" data-testid="text-active-crew-name">{activeCrew.name}</span> edition.</>
              : "Who's up, who's down, who should stop betting parlays."}
          </p>
          {activeCrew && crewActionsEnabled && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyInviteLink}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-2 py-1 font-mono text-xs font-bold text-primary transition-colors hover:bg-primary/20 hover:border-primary"
                data-testid="button-copy-invite-link"
                aria-label="Copy crew invite link"
              >
                <Link2 className="h-3 w-3" />
                Copy invite link
              </button>
              <button
                type="button"
                onClick={copyInviteCode}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
                data-testid="button-copy-invite-code"
                aria-label="Copy crew invite code"
              >
                <Copy className="h-3 w-3" />
                Code: <span className="font-bold tracking-widest text-primary">{activeCrew.inviteCode}</span>
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border/60 bg-card p-1" role="tablist" aria-label="Rank by">
            {([
              { value: "richest", label: "Richest" },
              { value: "sharpest", label: "Sharpest" },
            ] as { value: RankBy; label: string }[]).map((r) => (
              <button
                key={r.value}
                role="tab"
                aria-selected={rankBy === r.value}
                onClick={() => setRankBy(r.value)}
                data-testid={`tab-rank-${r.value}`}
                className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
                  rankBy === r.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
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
      </div>

      {/* Mobile has no sidebar — the crew picker gets a home on the Crew tab. */}
      <CrewSwitcher className="md:hidden" />

      {crews.length === 0 && crewActionsEnabled && (
        <Card className="border-primary/40 bg-primary/5" data-testid="card-no-crew">
          <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Users className="h-8 w-8 shrink-0 text-primary" />
              <div>
                <h2 className="font-semibold">You're not running with a crew yet</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Start one and drag your friends in, or join theirs with an invite code. Until then this board is just you talking to yourself.
                </p>
              </div>
            </div>
            <div className="w-full sm:w-56 shrink-0">
              <CrewSwitcher />
            </div>
          </CardContent>
        </Card>
      )}

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
              {rankBy === "richest"
                ? 'Settled results only — pending plays count as "in play", not rank. Tap a friend for the head-to-head.'
                : "Ranked by calibration — how well their stated confidence matched reality. Anyone can run hot; being right about being right is the hard part."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(rankBy === "richest" ? board : [...board].sort(sharpestSort)).map((e, i) => {
              const isYou = e.userId === activeUser?.id
              const isSelected = e.userId === selectedId
              const clickable = !isYou
              const displayRank = rankBy === "richest" ? e.rank : i + 1
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
                  <RankBadge rank={displayRank} />
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
                  {rankBy === "richest" ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <div className="hidden sm:block text-right shrink-0 w-20">
                        <div className="font-mono text-sm font-bold" data-testid={`text-postmortem-${e.userId}`}>
                          {e.postmortemRate != null ? `${e.postmortemRate.toFixed(0)}%` : "—"}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Reviewed</div>
                      </div>
                      <div className="text-right shrink-0 w-20">
                        <div
                          className={`font-mono text-sm font-bold ${e.calibrationScore != null && e.calibrationScore >= 75 ? "text-chart-1 text-glow-success" : ""}`}
                          data-testid={`text-calibration-${e.userId}`}
                        >
                          {e.calibrationScore != null ? e.calibrationScore.toFixed(1) : "—"}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Calibration</div>
                      </div>
                      <div className="hidden md:block text-right shrink-0 w-16">
                        <div className="font-mono text-sm" data-testid={`text-sound-${e.userId}`}>
                          {e.soundRate != null ? `${e.soundRate.toFixed(0)}%` : "—"}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Sound</div>
                      </div>
                    </>
                  )}
                </button>
              )
            })}
          </CardContent>
        </Card>
      )}

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
                  {([
                    { label: "Net Profit", a: me.totalProfit, b: them.totalProfit, fmt: (v: number) => `${v > 0 ? "+" : ""}${formatCurrency(v, false)}` },
                    { label: "ROI", a: me.roi, b: them.roi, fmt: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%` },
                    { label: "Win Rate", a: me.winRate, b: them.winRate, fmt: (v: number) => `${v.toFixed(1)}%` },
                    { label: "Bankroll", a: me.currentBankroll, b: them.currentBankroll, fmt: (v: number) => formatCurrency(v, false) },
                    // Decision quality — who's actually sharp vs. who's the
                    // best liar to themselves. Null means nothing to grade.
                    { label: "Calibration", a: me.calibrationScore, b: them.calibrationScore, fmt: (v: number) => v.toFixed(1) },
                    { label: "Post-Mortems", a: me.postmortemRate, b: them.postmortemRate, fmt: (v: number) => `${v.toFixed(0)}%` },
                    { label: "Sound Calls", a: me.soundRate, b: them.soundRate, fmt: (v: number) => `${v.toFixed(0)}%` },
                  ] as { label: string; a: number | null; b: number | null; fmt: (v: number) => string }[]).map((row) => (
                    <div key={row.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md bg-muted/20 px-3 py-2" data-testid={`row-compare-${row.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                      <span className={`font-mono text-sm font-bold ${row.a != null && (row.b == null || row.a > row.b) ? "text-primary" : ""}`}>
                        {row.a != null ? row.fmt(row.a) : "—"}
                      </span>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider text-center w-24">{row.label}</span>
                      <span className={`font-mono text-sm font-bold text-right ${row.b != null && (row.a == null || row.b > row.a) ? "text-primary" : ""}`}>
                        {row.b != null ? row.fmt(row.b) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {/* #156: calibration is the one row nobody can decode on sight — spell it out. */}
                <p className="mt-3 text-xs text-muted-foreground leading-relaxed" data-testid="text-calibration-explainer">
                  <span className="font-medium text-foreground/80">What's Calibration?</span>{" "}
                  Your win rate on plays you called confident (7+) minus your win rate on the ones
                  you didn't (3 or under). Positive means your gut actually ranks bets — when you
                  say you love a play, you win it more often. Near zero or negative means your
                  confidence score isn't telling you anything. Shows "—" until you've settled at
                  least 3 plays in each bucket.
                </p>
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
              <CardTitle className="text-base">{them.userName}'s Recent Plays</CardTitle>
              <CardDescription>The last five plays they put on the record — parlays included.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {isFriendPlaysLoading ? (
                <div className="animate-pulse h-24 rounded-md bg-muted/50" />
              ) : friendPlays.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-md">
                  No plays logged yet.
                </div>
              ) : (
                friendPlays.map((play) =>
                  play.kind === "bet" ? (
                    <div
                      key={`bet-${play.bet.id}`}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5"
                      data-testid={`row-friend-bet-${play.bet.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{play.bet.pick}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {play.bet.event} · {formatDate(play.bet.gameDate)} · {formatOdds(play.bet.odds)} · {formatCurrency(Number(play.bet.stake), false)}
                        </p>
                      </div>
                      <Badge
                        variant={play.bet.status === "won" ? "default" : play.bet.status === "lost" ? "destructive" : "secondary"}
                        className="shrink-0 text-[10px] uppercase"
                      >
                        {play.bet.status === "pending" ? "in play" : play.bet.status}
                      </Badge>
                    </div>
                  ) : (
                    <div
                      key={`parlay-${play.parlay.id}`}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5"
                      data-testid={`row-friend-parlay-${play.parlay.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 shrink-0 text-chart-5" />
                          <p className="truncate text-sm font-bold">{play.parlay.name}</p>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {play.parlay.legs.length}-leg parlay · {formatOdds(play.parlay.odds)} · {formatCurrency(Number(play.parlay.stake), false)}
                        </p>
                      </div>
                      <Badge
                        variant={play.parlay.status === "won" ? "default" : play.parlay.status === "lost" ? "destructive" : "secondary"}
                        className="shrink-0 text-[10px] uppercase"
                      >
                        {play.parlay.status === "pending" ? "in play" : play.parlay.status}
                      </Badge>
                    </div>
                  )
                )
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Crew challenges — weekly competitions on a single metric */}
      {activeCrew && (
        <CrewChallengeSection
          crewId={activeCrew.id}
          isOwner={activeCrew.role === "owner"}
        />
      )}

      {/* Every badge in the book — earned and still-locked, with the criteria */}
      {activeUser && <TrophyCase userId={activeUser.id} />}
    </div>
  )
}
