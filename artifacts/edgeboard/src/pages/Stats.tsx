import { useUser } from "@/contexts/UserContext"
import { useGetStatsSummary, useGetStatsBySport, useGetConfidenceAnalysis, useGetStatsInsights, useGetStatsPeerBenchmarks, getGetStatsSummaryQueryKey, getGetStatsBySportQueryKey, getGetConfidenceAnalysisQueryKey, getGetStatsInsightsQueryKey, getGetStatsPeerBenchmarksQueryKey } from "@workspace/api-client-react"
import type { PeerBenchmark } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useState, useEffect } from "react"
import { dayOf, addDays } from "@workspace/weeks"
import { QueryErrorCard } from "@/components/QueryErrorCard"
import { UpgradeCard } from "@/components/UpgradeCard"
import { useProStatus } from "@/hooks/use-pro"
import { formatCurrency } from "@/lib/format"
import { Link } from "wouter"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LineChart, Line } from "recharts"
import { BarChart2, Plus, Lock, Lightbulb, CheckCircle2, XCircle, ArrowRight, Target, TrendingUp, Users, EyeOff } from "lucide-react"

const BAND_CONFIG: Record<string, { label: string; color: string; pct: number }> = {
  top_10:     { label: "Top 10%",     color: "bg-chart-1",        pct: 95 },
  top_25:     { label: "Top 25%",     color: "bg-chart-1/70",     pct: 80 },
  median:     { label: "Middle 50%",  color: "bg-muted-foreground/50", pct: 50 },
  bottom_25:  { label: "Bottom 25%",  color: "bg-chart-2/70",     pct: 20 },
  bottom_10:  { label: "Bottom 10%",  color: "bg-chart-2",        pct: 5  },
}

function PeerBenchmarkGrid({
  benchmarks,
  sampleSize,
}: {
  benchmarks: PeerBenchmark[]
  sampleSize: number
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {benchmarks.map((b) => {
          const bandCfg = b.band ? BAND_CONFIG[b.band] ?? null : null
          const pct = b.percentile ?? bandCfg?.pct ?? 50
          const valueStr =
            b.userValue != null
              ? `${b.higherIsBetter && b.userValue > 0 ? "+" : ""}${b.userValue.toFixed(1)}${b.unit}`
              : "—"

          return (
            <Card key={b.metric} className="bg-card">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {b.label}
                  </div>
                  {bandCfg && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 shrink-0 border-0 ${
                        b.band === "top_10" || b.band === "top_25"
                          ? "bg-chart-1/15 text-chart-1"
                          : b.band === "bottom_10" || b.band === "bottom_25"
                          ? "bg-chart-2/15 text-chart-2"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {bandCfg.label}
                    </Badge>
                  )}
                </div>
                <div className="text-2xl font-bold font-mono">
                  {b.userValue != null ? (
                    <span className={
                      b.higherIsBetter
                        ? b.userValue > 0 ? "text-chart-1" : b.userValue < 0 ? "text-chart-2" : ""
                        : b.userValue > 50 ? "text-chart-2" : b.userValue > 25 ? "" : "text-chart-1"
                    }>{valueStr}</span>
                  ) : (
                    <span className="text-muted-foreground text-lg">Not enough data</span>
                  )}
                </div>
                {/* Percentile bar */}
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-muted overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all ${bandCfg ? bandCfg.color : "bg-muted-foreground/30"}`}
                      style={{ width: `${pct}%` }}
                    />
                    {/* Median marker */}
                    <div className="absolute top-0 left-1/2 w-px h-full bg-border/80" />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground/70">
                    <span>{b.higherIsBetter ? "Worst" : "Best"}</span>
                    <span>Median</span>
                    <span>{b.higherIsBetter ? "Best" : "Worst"}</span>
                  </div>
                </div>
                {b.percentile != null && (
                  <p className="text-xs text-muted-foreground">
                    Better than {b.percentile}% of TiltCheck bettors
                  </p>
                )}
                {b.userValue == null && (
                  <p className="text-xs text-muted-foreground">
                    Grade more bets to unlock this metric
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground text-right">
        Anonymized · {sampleSize.toLocaleString()} bettors · updated weekly · excludes demo data
      </p>
    </div>
  )
}

const MISS_REASON_LABELS: Record<string, string> = {
  bad_read: "Bad read",
  bad_price: "Bad price",
  lineup_injury: "Lineup / injury news",
  emotional: "Emotional bet",
  misunderstood_market: "Misunderstood market",
  normal_variance: "Normal variance",
  na: "N/A",
}

const RANGE_LABELS: Record<string, string> = {
  "30": "the last 30 days",
  "90": "the last 90 days",
}

function sinceForRange(range: string): string | undefined {
  if (range !== "30" && range !== "90") return undefined
  return addDays(dayOf(new Date()), -parseInt(range, 10))
}

function lessonsStorageKey(userId: number | undefined) {
  return userId != null ? `edgeboard:lessons-filter:${userId}` : null
}

function readLessonsFilter(userId: number | undefined): { sport: string; range: string } {
  const key = lessonsStorageKey(userId)
  if (!key) return { sport: "all", range: "all" }
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { sport: "all", range: "all" }
    const parsed = JSON.parse(raw)
    return {
      sport: typeof parsed.sport === "string" ? parsed.sport : "all",
      range: typeof parsed.range === "string" ? parsed.range : "all",
    }
  } catch {
    return { sport: "all", range: "all" }
  }
}

export default function Stats() {
  const { activeUser } = useUser()
  // Page-level filters: every section (summary, charts, lessons) follows these.
  // Persisted per-user in localStorage so the slice survives a page reload.
  const [filterSport, setFilterSport] = useState<string>(() => readLessonsFilter(activeUser?.id).sport)
  const [filterRange, setFilterRange] = useState<string>(() => readLessonsFilter(activeUser?.id).range)

  // Re-initialize from localStorage when the active user changes (e.g. account switch)
  useEffect(() => {
    const saved = readLessonsFilter(activeUser?.id)
    setFilterSport(saved.sport)
    setFilterRange(saved.range)
  }, [activeUser?.id])

  // Persist the current filter to localStorage whenever it changes
  useEffect(() => {
    const key = lessonsStorageKey(activeUser?.id)
    if (!key) return
    localStorage.setItem(key, JSON.stringify({ sport: filterSport, range: filterRange }))
  }, [activeUser?.id, filterSport, filterRange])

  // Collect all unique sports from the unfiltered by-sport fetch (used to
  // populate the sport picker — always shows all sports regardless of filter).
  const { data: allSportStats = [] } = useGetStatsBySport(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetStatsBySportQueryKey({ userId: activeUser?.id }) } }
  )

  const filterSince = sinceForRange(filterRange)
  const sharedFilterParams = {
    ...(filterSport !== "all" ? { sport: filterSport } : {}),
    ...(filterSince ? { since: filterSince } : {}),
  }

  const summaryParams = { userId: activeUser?.id, ...sharedFilterParams }
  const { data: summary, isLoading: isSummaryLoading, isError: isSummaryError, refetch: refetchSummary, isRefetching: isSummaryRefetching } = useGetStatsSummary(
    summaryParams,
    { query: { enabled: !!activeUser?.id, queryKey: getGetStatsSummaryQueryKey(summaryParams) } }
  )

  const sportParams = { userId: activeUser?.id, ...sharedFilterParams }
  const { data: sportStats = [], isLoading: isSportLoading, isError: isSportError, refetch: refetchSport, isRefetching: isSportRefetching } = useGetStatsBySport(
    sportParams,
    { query: { enabled: !!activeUser?.id, queryKey: getGetStatsBySportQueryKey(sportParams) } }
  )

  const confidenceParams = { userId: activeUser?.id, ...sharedFilterParams }
  const { data: confidenceData = [], isLoading: isConfidenceLoading, isError: isConfidenceError, refetch: refetchConfidence, isRefetching: isConfidenceRefetching } = useGetConfidenceAnalysis(
    confidenceParams,
    { query: { enabled: !!activeUser?.id, queryKey: getGetConfidenceAnalysisQueryKey(confidenceParams) } }
  )

  // If the persisted sport no longer appears in the bettor's data, fall back gracefully
  useEffect(() => {
    if (!isSportLoading && sportStats.length > 0 && filterSport !== "all") {
      const knownSports = sportStats.map((s) => s.sport)
      if (!knownSports.includes(filterSport)) {
        setFilterSport("all")
      }
    }
  }, [isSportLoading, sportStats, filterSport])

  // Lessons + peer benchmarks are Pro surfaces — keep queries off for free accounts.
  const { isPro, isProLoading, isProUnknown } = useProStatus()
  const { data: peerBenchmarks, isLoading: isPeerLoading } = useGetStatsPeerBenchmarks(
    { query: { enabled: isPro && !!activeUser?.id, queryKey: getGetStatsPeerBenchmarksQueryKey() } }
  )
  const insightsParams = {
    userId: activeUser?.id,
    ...sharedFilterParams,
  }
  const { data: insights, isLoading: isInsightsLoading } = useGetStatsInsights(
    insightsParams,
    { query: { enabled: isPro && !!activeUser?.id, queryKey: getGetStatsInsightsQueryKey(insightsParams) } }
  )
  const isFiltered = filterSport !== "all" || filterRange !== "all"

  // Build a short context label for card subtitles, e.g. "NBA · last 30 days"
  function sliceLabel(): string {
    const parts: string[] = []
    if (filterSport !== "all") parts.push(filterSport)
    if (filterRange !== "all") parts.push(RANGE_LABELS[filterRange] ?? "")
    return parts.join(" · ")
  }

  // Subtitle for straight-bet cards
  function straightSubtitle(): string {
    if (filterSport !== "all" && filterRange !== "all")
      return `${filterSport} straight bets · ${RANGE_LABELS[filterRange]}`
    if (filterSport !== "all") return `${filterSport} straight bets`
    if (filterRange !== "all") return `Straight bets · ${RANGE_LABELS[filterRange]}`
    return "Across all straight bets"
  }
  // keep old alias for the lessons empty-state copy
  const lessonsSport = filterSport
  const lessonsRange = filterRange
  const lessonsFiltered = isFiltered

  const isLoading = isSummaryLoading || isSportLoading || isConfidenceLoading
  const isError = isSummaryError || isSportError || isConfidenceError
  const isRetrying = isSummaryRefetching || isSportRefetching || isConfidenceRefetching
  const retry = () => {
    if (isSummaryError) refetchSummary()
    if (isSportError) refetchSport()
    if (isConfidenceError) refetchConfidence()
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <QueryErrorCard
          title="Your analytics didn't load."
          message="Not a bad beat — just a connection problem. The numbers haven't gone anywhere."
          onRetry={retry}
          isRetrying={isRetrying}
          testId="card-stats-error"
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => (
            <Card key={i} className="animate-pulse bg-muted/50 h-32" />
          ))}
        </div>
      </div>
    )
  }

  if (!summary) return null

  const gradedBets = (summary.straightBetRecord.wins + summary.straightBetRecord.losses + summary.straightBetRecord.pushes)
    + (summary.parlayRecord.wins + summary.parlayRecord.losses + summary.parlayRecord.pushes)
  const INSIGHTS_THRESHOLD = 5
  const hasEnoughData = gradedBets >= INSIGHTS_THRESHOLD
  const totalBets = gradedBets + (summary.pending ?? 0)

  if (totalBets === 0 && !isFiltered) {
    return (
      <div className="space-y-8 animate-in fade-in-50 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">Deep dive into your betting performance.</p>
        </div>
        <Card className="border-dashed border-2 border-primary/20 bg-primary/5" data-testid="card-stats-empty">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-6 text-center">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <BarChart2 className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">This page becomes your scouting report</h2>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                Grade {INSIGHTS_THRESHOLD} bets and the charts light up — no vibes, just your actual numbers.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg">
              <div className="flex flex-col items-center gap-1.5 p-4 rounded-lg bg-background/60 border border-border/50">
                <TrendingUp className="h-5 w-5 text-primary" />
                <div className="text-sm font-medium">Profit by sport</div>
                <div className="text-xs text-muted-foreground">Which leagues pay you, which collect</div>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-4 rounded-lg bg-background/60 border border-border/50">
                <Target className="h-5 w-5 text-primary" />
                <div className="text-sm font-medium">Calibration</div>
                <div className="text-xs text-muted-foreground">Does your confidence match reality?</div>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-4 rounded-lg bg-background/60 border border-border/50">
                <Lightbulb className="h-5 w-5 text-primary" />
                <div className="text-sm font-medium">Lessons</div>
                <div className="text-xs text-muted-foreground">Patterns from your own post-mortems</div>
              </div>
            </div>
            <Button asChild>
              <Link href="/bets/new"><Plus className="h-4 w-4 mr-1" />Log First Bet</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const sortedConfidenceData = [...confidenceData].sort((a, b) => {
    const aVal = parseInt(a.confidenceRange.split('-')[0])
    const bVal = parseInt(b.confidenceRange.split('-')[0])
    return aVal - bVal
  })

  const sortedSportData = [...sportStats].sort((a, b) => b.totalWagered - a.totalWagered).slice(0, 7)

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">Deep dive into your betting performance.</p>
        </div>
        {/* Page-level slice controls — every section follows these */}
        <div className="flex flex-wrap items-center gap-2" data-testid="stats-filter-controls">
          <Select value={filterSport} onValueChange={setFilterSport}>
            <SelectTrigger className="h-8 w-[140px]" data-testid="select-stats-sport">
              <SelectValue placeholder="All sports" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sports</SelectItem>
              {[...allSportStats].map((s) => s.sport).sort().map((sport) => (
                <SelectItem key={sport} value={sport}>{sport}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex rounded-md border overflow-hidden">
            {[
              { value: "30", label: "30d" },
              { value: "90", label: "90d" },
              { value: "all", label: "All time" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilterRange(opt.value)}
                data-testid={`button-stats-range-${opt.value}`}
                className={`px-3 h-8 text-xs font-medium transition-colors ${
                  filterRange === opt.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Insight unlock progress banner */}
      {!hasEnoughData && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Insights unlock after {INSIGHTS_THRESHOLD} graded bets</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {gradedBets} of {INSIGHTS_THRESHOLD} graded so far — {INSIGHTS_THRESHOLD - gradedBets} more to go
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div 
                  className="h-full rounded-full bg-primary transition-all" 
                  style={{ width: `${Math.min(100, (gradedBets / INSIGHTS_THRESHOLD) * 100)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Straight Bets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {summary.straightBetRecord.wins}-{summary.straightBetRecord.losses}{summary.straightBetRecord.pushes > 0 ? `-${summary.straightBetRecord.pushes}` : ''}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Win Rate: {((summary.straightBetRecord.wins / Math.max(1, summary.straightBetRecord.wins + summary.straightBetRecord.losses)) * 100).toFixed(1)}%
            </p>
            {isFiltered && (
              <p className="text-xs text-muted-foreground/70 mt-0.5 truncate" data-testid="text-straight-bets-slice">
                {straightSubtitle()}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className={`bg-card ${filterSport !== "all" ? "opacity-60" : ""}`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Parlays</CardTitle>
          </CardHeader>
          <CardContent>
            {filterSport !== "all" ? (
              <>
                <div className="text-2xl font-bold font-mono text-muted-foreground">—</div>
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-parlays-sport-note">
                  Parlays span sports and aren't included in this slice
                </p>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold font-mono">
                  {summary.parlayRecord.wins}-{summary.parlayRecord.losses}{summary.parlayRecord.pushes > 0 ? `-${summary.parlayRecord.pushes}` : ''}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Hit Rate: {((summary.parlayRecord.wins / Math.max(1, summary.parlayRecord.wins + summary.parlayRecord.losses)) * 100).toFixed(1)}%
                </p>
                {filterRange !== "all" && (
                  <p className="text-xs text-muted-foreground/70 mt-0.5 truncate" data-testid="text-parlays-slice">
                    Parlays · {RANGE_LABELS[filterRange]}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Best Bet P/L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-chart-1 text-glow-success">
              +{formatCurrency(summary.bestBetProfit)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isFiltered ? `Highest single payout · ${sliceLabel()}` : "Highest single payout"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Odds</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {summary.avgOdds > 0 ? '+' : ''}{Math.round(summary.avgOdds)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{straightSubtitle()}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle>Profit by Sport</CardTitle>
            <CardDescription>Top sports by net profit/loss</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {!hasEnoughData ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center border border-dashed rounded-md p-4">
                <Lock className="h-6 w-6 text-muted-foreground/50" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Unlocks at {INSIGHTS_THRESHOLD} graded bets</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">{gradedBets}/{INSIGHTS_THRESHOLD} graded</p>
                </div>
              </div>
            ) : sortedSportData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sortedSportData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="sport" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip 
                    cursor={{ fill: 'hsl(var(--muted)/0.5)' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '0.5rem' }}
                    itemStyle={{ color: 'hsl(var(--foreground))', fontFamily: 'monospace' }}
                    formatter={(value: number) => [formatCurrency(value), 'Profit']}
                  />
                  <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                    {sortedSportData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? 'hsl(var(--chart-1))' : 'hsl(var(--chart-2))'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground border border-dashed rounded-md text-sm text-center px-4">
                {isFiltered ? "No graded bets in this slice — widen the filter." : "No sport data yet"}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle>Confidence Calibration</CardTitle>
            <CardDescription>Win rate by confidence score</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {!hasEnoughData ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center border border-dashed rounded-md p-4">
                <Lock className="h-6 w-6 text-muted-foreground/50" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Unlocks at {INSIGHTS_THRESHOLD} graded bets</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">{gradedBets}/{INSIGHTS_THRESHOLD} graded</p>
                </div>
              </div>
            ) : sortedConfidenceData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sortedConfidenceData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="confidenceRange" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} domain={[0, 100]} />
                  <Tooltip 
                    cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '3 3' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '0.5rem' }}
                    formatter={(value: number) => [`${value}%`, 'Win Rate']}
                    labelFormatter={(label) => `Confidence: ${label}`}
                  />
                  <Line type="monotone" dataKey="winRate" stroke="hsl(var(--chart-3))" strokeWidth={3} dot={{ r: 6, fill: 'hsl(var(--background))', strokeWidth: 2 }} activeDot={{ r: 8 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground border border-dashed rounded-md text-sm text-center px-4">
                {isFiltered ? "No graded bets in this slice — widen the filter." : "No confidence data yet"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Post-result insights feed */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-auto">
            <Lightbulb className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Lessons</h2>
          </div>
          <Link href="/lessons" className="inline-flex items-center gap-1 text-sm text-primary hover:underline underline-offset-4" data-testid="link-stats-lesson-library">
            Lesson Library
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {!isPro ? (
          isProLoading ? (
            <Card className="animate-pulse bg-muted/50 h-32" />
          ) : isProUnknown ? null : (
            <UpgradeCard compact feature="The Lessons feed" />
          )
        ) : isInsightsLoading ? (
          <Card className="animate-pulse bg-muted/50 h-32" />
        ) : !insights || insights.reviewedCount < 3 ? (
          <Card className="border-dashed border-2 border-muted" data-testid="card-lessons-empty">
            <CardContent className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Lightbulb className="h-6 w-6 text-muted-foreground" />
              </div>
              {lessonsFiltered ? (
                <div>
                  <h3 className="font-semibold">Not much to learn from this slice</h3>
                  <p className="text-muted-foreground text-sm mt-1 max-w-md">
                    {lessonsSport !== "all" ? `${lessonsSport} ` : "Your plays "}
                    {lessonsRange !== "all" ? `over ${RANGE_LABELS[lessonsRange]} ` : ""}
                    {insights && insights.reviewedCount > 0
                      ? `only has ${insights.reviewedCount} reviewed ${insights.reviewedCount === 1 ? "play" : "plays"} — patterns need at least 3.`
                      : "has no reviewed plays yet — patterns need at least 3."}
                    {" "}Widen the filter or grade more bets in this slice.
                  </p>
                </div>
              ) : (
                <div>
                  <h3 className="font-semibold">Not enough reviews yet</h3>
                  <p className="text-muted-foreground text-sm mt-1 max-w-md">
                    Grade at least 3 bets with review details (reasoning quality, miss reason, or notes) to unlock
                    patterns from your post-game reviews.
                    {insights ? ` ${insights.reviewedCount} of 3 reviewed so far.` : ""}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
          {lessonsSport !== "all" && (
            <p className="text-xs text-muted-foreground" data-testid="text-lessons-sport-note">
              Parlays span sports, so this {lessonsSport} slice covers straight bets only.
            </p>
          )}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="bg-card">
              <CardHeader>
                <CardTitle className="text-base">Why You Lost</CardTitle>
                <CardDescription>Miss reasons across {insights.lossesWithReason} graded {insights.lossesWithReason === 1 ? "loss" : "losses"}</CardDescription>
              </CardHeader>
              <CardContent>
                {insights.missReasons.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-md">
                    No miss reasons recorded on losses yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {insights.missReasons.map((r) => (
                      <div key={r.reason}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium">{MISS_REASON_LABELS[r.reason] ?? r.reason}</span>
                          <span className="font-mono text-muted-foreground">{r.count} of {insights.lossesWithReason}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${r.reason === "normal_variance" ? "bg-chart-3" : "bg-destructive/70"}`}
                            style={{ width: `${Math.round((r.count / Math.max(1, insights.lossesWithReason)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    {insights.missReasons[0] && insights.missReasons[0].reason !== "normal_variance" && insights.missReasons[0].count >= 2 && (
                      <p className="text-xs text-muted-foreground pt-2 border-t">
                        {insights.missReasons[0].count} of your {insights.lossesWithReason} losses were marked "{MISS_REASON_LABELS[insights.missReasons[0].reason]?.toLowerCase() ?? insights.missReasons[0].reason}" — worth a closer look.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card">
              <CardHeader>
                <CardTitle className="text-base">Process vs. Results</CardTitle>
                <CardDescription>Win rate by reasoning quality</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {insights.soundReasoning.total === 0 && insights.flawedReasoning.total === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-md">
                    No reasoning grades recorded yet.
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 className="h-5 w-5 text-chart-1 drop-shadow-[0_0_8px_hsl(var(--chart-1)/0.6)]" />
                        <span className="text-sm font-bold text-chart-1 text-glow-success">Sound reasoning</span>
                      </div>
                      <div className="text-2xl font-bold font-mono text-foreground">{insights.soundReasoning.winRate.toFixed(1)}%</div>
                      <p className="text-xs text-muted-foreground mt-1">{insights.soundReasoning.wins} wins on {insights.soundReasoning.total} graded {insights.soundReasoning.total === 1 ? "bet" : "bets"}</p>
                    </div>
                    <div className="rounded-md border p-4 bg-card hover:border-chart-2/40 transition-colors">
                      <div className="flex items-center gap-2 mb-1">
                        <XCircle className="h-5 w-5 text-chart-2 drop-shadow-[0_0_8px_hsl(var(--chart-2)/0.6)]" />
                        <span className="text-sm font-bold text-chart-2 text-glow-destructive">Flawed reasoning</span>
                      </div>
                      <div className="text-2xl font-bold font-mono text-foreground">{insights.flawedReasoning.winRate.toFixed(1)}%</div>
                      <p className="text-xs text-muted-foreground mt-1">{insights.flawedReasoning.wins} wins on {insights.flawedReasoning.total} graded {insights.flawedReasoning.total === 1 ? "bet" : "bets"}</p>
                    </div>
                    {insights.soundReasoning.total > 0 && insights.flawedReasoning.total > 0 && insights.soundReasoning.winRate > insights.flawedReasoning.winRate && (
                      <p className="text-xs text-muted-foreground">
                        Your sound-reasoning bets win {(insights.soundReasoning.winRate - insights.flawedReasoning.winRate).toFixed(0)} points more often — trust the process.
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card">
              <CardHeader>
                <CardTitle className="text-base">Recent Reviews</CardTitle>
                <CardDescription>Your latest "what happened" notes</CardDescription>
              </CardHeader>
              <CardContent>
                {insights.recentNotes.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-md">
                    No review notes written yet.
                  </div>
                ) : (
                  <div className="max-h-[320px] overflow-y-auto space-y-3 pr-1">
                    {insights.recentNotes.map((note) => (
                      <Link
                        key={`${note.type}-${note.id}`}
                        href={note.type === "parlay" ? `/parlays/${note.id}` : `/bets/${note.id}`}
                        className="block rounded-md border p-3 hover:bg-muted/50 transition-colors group"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-medium truncate">{note.title}</span>
                          <Badge variant={note.status === "won" ? "default" : note.status === "lost" ? "destructive" : "secondary"} className="shrink-0 text-[10px] uppercase">
                            {note.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{note.whatHappened}</p>
                        <div className="flex items-center gap-1 text-xs text-primary mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          View bet <ArrowRight className="h-3 w-3" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          </div>
        )}
      </div>

      {/* ── vs. The Field (Pro) ────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">vs. The Field</h2>
          <Badge variant="outline" className="border-primary/50 bg-primary/15 text-primary text-[10px] px-1.5 py-0">Pro</Badge>
        </div>
        {!isPro ? (
          isProLoading ? (
            <Card className="animate-pulse bg-muted/50 h-32" />
          ) : isProUnknown ? null : (
            <UpgradeCard compact feature="Anonymous peer benchmarking" />
          )
        ) : isPeerLoading ? (
          <Card className="animate-pulse bg-muted/50 h-44" />
        ) : !peerBenchmarks ? null : peerBenchmarks.optedOut ? (
          <Card className="border-dashed border-2 border-muted">
            <CardContent className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <EyeOff className="h-8 w-8 text-muted-foreground/50" />
              <div>
                <h3 className="font-semibold">You've opted out of benchmarking</h3>
                <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                  Turn "Include my data in anonymous benchmarks" back on in Account settings to see how you rank against the field.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : peerBenchmarks.sampleSize < 5 ? (
          <Card className="border-dashed border-2 border-muted">
            <CardContent className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <Users className="h-8 w-8 text-muted-foreground/50" />
              <div>
                <h3 className="font-semibold">Not enough data yet</h3>
                <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                  Percentiles are computed once enough bettors have graded plays. Check back soon.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <PeerBenchmarkGrid benchmarks={peerBenchmarks.benchmarks} sampleSize={peerBenchmarks.sampleSize} />
        )}
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Sport Breakdown</CardTitle>
          <CardDescription>Detailed statistics per sport</CardDescription>
        </CardHeader>
        <CardContent>
          {sortedSportData.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground border border-dashed rounded-md">
              {isFiltered ? (
                <>
                  <p className="text-sm">No graded bets in this slice.</p>
                  <p className="text-xs mt-1">Widen the filter to see the breakdown.</p>
                </>
              ) : (
                <>
                  <p className="text-sm">No graded bets yet.</p>
                  <p className="text-xs mt-1">Grade a bet to see sport-level breakdown.</p>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                  <tr>
                    <th className="px-4 py-3 font-medium">Sport</th>
                    <th className="px-4 py-3 font-medium text-right">Bets</th>
                    <th className="px-4 py-3 font-medium text-right">Record</th>
                    <th className="px-4 py-3 font-medium text-right">Win Rate</th>
                    <th className="px-4 py-3 font-medium text-right">Wagered</th>
                    <th className="px-4 py-3 font-medium text-right">Profit</th>
                    <th className="px-4 py-3 font-medium text-right">ROI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedSportData.map((sport) => (
                    <tr key={sport.sport} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-medium">{sport.sport}</td>
                      <td className="px-4 py-3 text-right font-mono">{sport.wins + sport.losses + sport.pushes}</td>
                      <td className="px-4 py-3 text-right font-mono">{sport.wins}-{sport.losses}{sport.pushes > 0 ? `-${sport.pushes}` : ''}</td>
                      <td className="px-4 py-3 text-right font-mono">{sport.winRate.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(sport.totalWagered, true)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${sport.profit > 0 ? 'text-chart-1' : sport.profit < 0 ? 'text-chart-2' : ''}`}>
                        {sport.profit > 0 ? '+' : ''}{formatCurrency(sport.profit, true)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${sport.roi > 0 ? 'text-chart-1' : sport.roi < 0 ? 'text-chart-2' : ''}`}>
                        {sport.roi > 0 ? '+' : ''}{sport.roi.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
