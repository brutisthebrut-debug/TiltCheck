import { useEffect, useMemo, useRef, useState } from "react"
import { useUser } from "@/contexts/UserContext"
import { useGetWeeklyRecap, getGetWeeklyRecapQueryKey, useGetRecapNarrative, getGetRecapNarrativeQueryKey, useMarkRecapSeen, getGetCurrentUserQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatOdds } from "@/lib/format"
import { ChevronLeft, ChevronRight, Trophy, Skull, Droplets, Users, Sparkles, Crown, Rocket, CloudRain, WifiOff, RotateCw, Clapperboard } from "lucide-react"
import { addDays, latestRecapWeekStart, isRecapUnseen } from "@/lib/recapTeaser"

const MISS_REASON_PHRASES: Record<string, string> = {
  bad_read: "bad reads",
  bad_price: "bad prices",
  lineup_injury: "lineup and injury news you didn't check",
  emotional: "emotional bets",
  misunderstood_market: "markets you didn't understand",
}

function formatWeekRange(weekStart: string, weekEnd: string): string {
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  return `${fmt(weekStart)} – ${fmt(weekEnd)}`
}

export default function Recap() {
  const { activeUser } = useUser()
  const latest = useMemo(() => latestRecapWeekStart(), [])
  const [weekStart, setWeekStart] = useState(latest)

  // Reading any recap counts as having seen this week's — kills the teaser.
  // Recorded server-side so it holds on every device. Best-effort: if the
  // write fails, the teaser just shows again.
  const queryClient = useQueryClient()
  const markSeen = useMarkRecapSeen({
    mutation: {
      onSuccess: (updatedUser) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), updatedUser)
      },
    },
  })
  const markedRef = useRef(false)
  useEffect(() => {
    if (!activeUser?.id || markedRef.current) return
    if (!isRecapUnseen(activeUser.recapSeenWeek)) return
    markedRef.current = true
    markSeen.mutate()
  }, [activeUser?.id, activeUser?.recapSeenWeek, markSeen])

  const { data: recap, isLoading, isError, refetch, isRefetching } = useGetWeeklyRecap(
    { userId: activeUser?.id, weekStart },
    { query: { enabled: !!activeUser?.id, queryKey: getGetWeeklyRecapQueryKey({ userId: activeUser?.id, weekStart }) } }
  )

  // The narrated tape review — generated once per week server-side, then
  // cached. Purely additive: while loading or unavailable, the recap reads
  // exactly like it did before this section existed.
  const {
    data: tape,
    isLoading: tapeLoading,
    isError: tapeError,
    refetch: refetchTape,
    isRefetching: tapeRefetching,
  } = useGetRecapNarrative(
    { userId: activeUser?.id, weekStart },
    {
      query: {
        enabled: !!activeUser?.id,
        queryKey: getGetRecapNarrativeQueryKey({ userId: activeUser?.id, weekStart }),
        staleTime: Infinity,
        retry: false,
      },
    }
  )

  if (!activeUser) return null

  const p = recap?.personal
  const quietWeek = p != null && p.loggedCount === 0 && p.settledCount === 0
  const units = p && p.settledCount > 0 && p.totalWagered > 0
    ? p.profit / (p.totalWagered / p.settledCount)
    : 0

  const recordLine = !p ? "" :
    p.settledCount === 0 ? "Nothing graded this week. The record book stays clean." :
    p.profit > 0 ? "A winning week. Enjoy it — variance is taking notes." :
    p.profit < 0 ? "The books thank you for your continued service." :
    "Perfectly break-even. Riveting stuff."

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500 max-w-2xl mx-auto" data-testid="page-recap">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Weekly Recap</h1>
          <p className="text-muted-foreground mt-1">How you actually did. No spin.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" data-testid="button-recap-prev" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-mono text-sm min-w-[7.5rem] text-center" data-testid="text-recap-week">
            {recap ? formatWeekRange(recap.weekStart, recap.weekEnd) : "…"}
          </div>
          <Button
            variant="outline"
            size="icon"
            data-testid="button-recap-next"
            disabled={weekStart >= latest}
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isError ? (
        <Card className="border-dashed border-2 border-muted" data-testid="card-recap-error">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <WifiOff className="h-8 w-8 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">The recap didn't load.</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Not a bad beat — just a connection problem. Try again, or flip to another week.
              </p>
            </div>
            <Button
              variant="outline"
              data-testid="button-recap-retry"
              disabled={isRefetching}
              onClick={() => refetch()}
            >
              <RotateCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
              {isRefetching ? "Retrying…" : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : isLoading || !recap ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse bg-muted/50 h-32" />)}
        </div>
      ) : quietWeek ? (
        <Card className="border-dashed border-2 border-muted" data-testid="card-recap-empty">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">You didn't bet.</h2>
              <p className="text-muted-foreground text-sm mt-1">Your bankroll thanks you.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Your record */}
          <Card data-testid="card-recap-record" className="border-primary/30 bg-primary/10 glow-primary relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Trophy className="h-32 w-32" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription className="uppercase tracking-wider text-[11px] text-primary/80 font-bold">Your week</CardDescription>
              <CardTitle className="text-4xl font-mono text-glow-primary">
                {p!.wins}-{p!.losses}{p!.pushes > 0 ? `-${p!.pushes}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline gap-3 flex-wrap font-mono">
                <span className={`text-2xl font-bold ${p!.profit > 0 ? "text-chart-1 text-glow-success" : p!.profit < 0 ? "text-chart-2 text-glow-destructive" : ""}`}>
                  {p!.profit > 0 ? "+" : ""}{formatCurrency(p!.profit)}
                </span>
                {p!.settledCount > 0 && (
                  <>
                    <span className="text-sm text-foreground/80">{units > 0 ? "+" : ""}{units.toFixed(1)}u</span>
                    <span className="text-sm text-foreground/80">{p!.roi > 0 ? "+" : ""}{p!.roi.toFixed(1)}% ROI</span>
                  </>
                )}
              </div>
              <p className="text-sm font-medium text-foreground/90">{recordLine}</p>
            </CardContent>
          </Card>

          {/* The tape — AI-narrated decision review */}
          {tapeError ? (
            <Card className="border-dashed border-2 border-muted" data-testid="card-recap-tape-error">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clapperboard className="h-4 w-4 text-muted-foreground" />
                  <CardDescription className="uppercase tracking-wider text-[11px]">The tape</CardDescription>
                </div>
                <CardTitle className="text-base">Couldn't load your review.</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  The rest of the recap made it — this part didn't. Give it another go.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-recap-tape-retry"
                  disabled={tapeRefetching}
                  onClick={() => refetchTape()}
                >
                  <RotateCw className={`h-4 w-4 mr-2 ${tapeRefetching ? "animate-spin" : ""}`} />
                  {tapeRefetching ? "Retrying…" : "Retry"}
                </Button>
              </CardContent>
            </Card>
          ) : tapeLoading && !tape ? (
            <Card className="border-primary/20" data-testid="card-recap-tape-loading">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clapperboard className="h-4 w-4 text-primary" />
                  <CardDescription className="uppercase tracking-wider text-[11px]">The tape</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-3 rounded bg-muted/60 animate-pulse" />
                <div className="h-3 rounded bg-muted/60 animate-pulse w-11/12" />
                <div className="h-3 rounded bg-muted/60 animate-pulse w-4/5" />
              </CardContent>
            </Card>
          ) : tape && tape.narrative == null && p!.settledCount === 0 ? (
            <Card className="border-dashed border-2 border-muted" data-testid="card-recap-tape-empty">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clapperboard className="h-4 w-4 text-muted-foreground" />
                  <CardDescription className="uppercase tracking-wider text-[11px]">The tape</CardDescription>
                </div>
                <CardTitle className="text-base">No tape this week.</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Nothing graded yet — once your first bets settle, the review shows up here.
                </p>
              </CardContent>
            </Card>
          ) : tape?.narrative ? (
            <Card className="border-primary/20 bg-primary/5 animate-in fade-in-50 duration-500" data-testid="card-recap-tape">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clapperboard className="h-4 w-4 text-primary" />
                  <CardDescription className="uppercase tracking-wider text-[11px]">The tape</CardDescription>
                </div>
                <CardTitle className="text-base">Your week, reviewed.</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {tape.narrative.split(/\n{2,}|\n/).filter((s) => s.trim().length > 0).map((para, i) => (
                  <p key={i} className="text-sm leading-relaxed text-foreground/90">{para}</p>
                ))}
              </CardContent>
            </Card>
          ) : tape?.limitReached ? (
            <Card className="border-dashed border-2 border-muted" data-testid="card-recap-tape-limit">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clapperboard className="h-4 w-4 text-muted-foreground" />
                  <CardDescription className="uppercase tracking-wider text-[11px]">The tape</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  You've hit today's limit for generating older weeks' reviews. Weeks you've
                  already reviewed still load instantly — this one will be ready tomorrow.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Best win */}
          {p!.bestWin && (
            <Card className="border-chart-1/40 bg-chart-1/10 glow-success" data-testid="card-recap-best-win">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-chart-1 drop-shadow-[0_0_8px_hsl(var(--chart-1)/0.8)]" />
                  <CardDescription className="uppercase tracking-wider text-[11px] font-bold text-chart-1/80">Best call</CardDescription>
                </div>
                <CardTitle className="text-lg">{p!.bestWin.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-2xl font-bold text-chart-1 text-glow-success">+{formatCurrency(p!.bestWin.amount)}</p>
                <p className="text-xs text-foreground/80 mt-2">At {formatOdds(p!.bestWin.odds)}. This is the one you'll bring up all month.</p>
              </CardContent>
            </Card>
          )}

          {/* Worst beat */}
          {p!.worstBeat && (
            <Card className="border-chart-2/40 bg-chart-2/10 glow-destructive" data-testid="card-recap-worst-beat">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Skull className="h-5 w-5 text-chart-2 drop-shadow-[0_0_8px_hsl(var(--chart-2)/0.8)]" />
                  <CardDescription className="uppercase tracking-wider text-[11px] font-bold text-chart-2/80">Worst beat</CardDescription>
                </div>
                <CardTitle className="text-lg">{p!.worstBeat.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-2xl font-bold text-chart-2 text-glow-destructive">{formatCurrency(p!.worstBeat.amount)}</p>
                <p className="text-xs text-foreground/80 mt-2">At {formatOdds(p!.worstBeat.odds)}. We don't have to talk about it. But it's staying in the record.</p>
              </CardContent>
            </Card>
          )}

          {/* The leak */}
          {p!.leak && (
            <Card className="border-[#ff9900]/40 bg-[#ff9900]/10 glow-amber" data-testid="card-recap-leak">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Droplets className="h-5 w-5 text-[#ff9900] drop-shadow-[0_0_8px_rgba(255,153,0,0.8)]" />
                  <CardDescription className="uppercase tracking-wider text-[11px] font-bold text-[#ff9900]/80">The leak</CardDescription>
                </div>
                <CardTitle className="text-lg text-glow-warning text-[#ff9900]">
                  {p!.leak.kind === "sport" && <>You lose money on {p!.leak.label}.</>}
                  {p!.leak.kind === "parlays" && <>Parlays are not your friend.</>}
                  {p!.leak.kind === "miss_reason" && <>Your money is leaking to {MISS_REASON_PHRASES[p!.leak.label] ?? p!.leak.label}.</>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-2xl font-bold text-[#ff9900] text-glow-warning">{formatCurrency(p!.leak.amount)}</p>
                <p className="text-xs text-foreground/80 mt-2">
                  {p!.leak.count} losing {p!.leak.count === 1 ? "play" : "plays"} this week. Plainly stated so you can't unsee it.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Crew section */}
          <div className="flex items-center gap-2 pt-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">The Crew</h2>
          </div>

          {!recap.crew.winner && !recap.crew.biggestUpset && !recap.crew.worstBeat ? (
            <Card className="border-dashed border-2 border-muted" data-testid="card-recap-crew-empty">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Nobody graded anything this week. A rare outbreak of discipline.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {recap.crew.winner && (
                <Card data-testid="card-recap-crew-winner" className="border-chart-1/30 bg-chart-1/5 glow-success transition-all hover:bg-chart-1/10">
                  <CardContent className="flex items-center gap-4 py-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-chart-1/15 ring-1 ring-chart-1/40">
                      <Crown className="h-6 w-6 text-chart-1 drop-shadow-[0_0_8px_hsl(var(--chart-1)/0.8)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold truncate text-chart-1 text-glow-success">
                        {recap.crew.winner.userName} won the week
                        {recap.crew.winner.userId === activeUser.id ? " (that's you)" : ""}
                      </div>
                      <div className="text-xs text-foreground/80 font-mono mt-1">
                        {recap.crew.winner.wins}-{recap.crew.winner.losses} ·{" "}
                        <span className={recap.crew.winner.profit >= 0 ? "text-chart-1 font-bold" : "text-chart-2 font-bold"}>
                          {recap.crew.winner.profit > 0 ? "+" : ""}{formatCurrency(recap.crew.winner.profit)}
                        </span>
                        {recap.crew.winner.profit < 0 ? " — winning the week by losing the least" : ""}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              {recap.crew.biggestUpset && (
                <Card data-testid="card-recap-crew-upset" className="border-[#ff9900]/30 bg-[#ff9900]/5 glow-amber transition-all hover:bg-[#ff9900]/10">
                  <CardContent className="flex items-center gap-4 py-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#ff9900]/15 ring-1 ring-[#ff9900]/40">
                      <Rocket className="h-6 w-6 text-[#ff9900] drop-shadow-[0_0_8px_rgba(255,153,0,0.8)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold truncate text-[#ff9900] text-glow-warning">
                        {recap.crew.biggestUpset.userName} hit {formatOdds(recap.crew.biggestUpset.odds)}
                      </div>
                      <div className="text-xs text-foreground/80 mt-1 truncate">
                        {recap.crew.biggestUpset.title} · <span className="font-mono font-bold text-[#ff9900]">+{formatCurrency(recap.crew.biggestUpset.amount)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              {recap.crew.worstBeat && (
                <Card data-testid="card-recap-crew-beat" className="border-chart-2/30 bg-chart-2/5 glow-destructive transition-all hover:bg-chart-2/10">
                  <CardContent className="flex items-center gap-4 py-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-chart-2/15 ring-1 ring-chart-2/40">
                      <CloudRain className="h-6 w-6 text-chart-2 drop-shadow-[0_0_8px_hsl(var(--chart-2)/0.8)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold truncate text-chart-2 text-glow-destructive">
                        {recap.crew.worstBeat.userName} took the week's worst beat
                      </div>
                      <div className="text-xs text-foreground/80 mt-1 truncate">
                        {recap.crew.worstBeat.title} · <span className="font-mono font-bold text-chart-2">{formatCurrency(recap.crew.worstBeat.amount)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
