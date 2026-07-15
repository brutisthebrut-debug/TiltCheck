import { useState } from "react"
import { useUser } from "@/contexts/UserContext"
import { useGetEdgeFinder, getGetEdgeFinderQueryKey } from "@workspace/api-client-react"
import type { EdgeFinderLane } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { QueryErrorCard } from "@/components/QueryErrorCard"
import { UpgradeCard } from "@/components/UpgradeCard"
import { useProStatus } from "@/hooks/use-pro"
import { formatCurrency } from "@/lib/format"
import { Link } from "wouter"
import { Crosshair, TrendingUp, TrendingDown, Plus, ArrowRight, ShieldQuestion } from "lucide-react"

// Human labels for the fixed lane keys each dimension uses.
const FAV_DOG_LABELS: Record<string, string> = {
  favorite: "Favorites",
  underdog: "Underdogs",
}
const ODDS_BAND_LABELS: Record<string, string> = {
  heavy_fav: "Heavy favorites (-200 and heavier)",
  fav: "Favorites (-100 to -199)",
  dog: "Underdogs (+100 to +199)",
  long_shot: "Long shots (+200 and longer)",
}
const ODDS_BAND_SHORT: Record<string, string> = {
  heavy_fav: "Heavy favorites",
  fav: "Favorites",
  dog: "Underdogs",
  long_shot: "Long shots",
}
const DAY_LABELS: Record<string, string> = {
  mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays",
  fri: "Fridays", sat: "Saturdays", sun: "Sundays",
}
const STAKE_LABELS: Record<string, string> = {
  light: "Light stakes",
  standard: "Standard stakes",
  heavy: "Heavy stakes",
}

type Dimension = {
  id: string
  title: string
  description: string
  lanes: EdgeFinderLane[]
  label: (key: string) => string
  heroLabel: (key: string) => string
  href?: (key: string) => string
}

function record(l: EdgeFinderLane): string {
  return `${l.wins}-${l.losses}${l.pushes > 0 ? `-${l.pushes}` : ""}`
}

function signedCurrency(n: number): string {
  return `${n > 0 ? "+" : ""}${formatCurrency(n, true)}`
}

type Period = "week" | "month" | "all"

const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
]

export default function EdgeFinder() {
  const { activeUser } = useUser()
  const [period, setPeriod] = useState<Period>("all")
  const [sport, setSport] = useState<string | null>(null)
  const hasFilters = period !== "all" || sport != null

  // Edge Finder is the flagship Pro surface — queries stay off for free
  // accounts so the 402 never reads as a connection problem.
  const { isPro, isProLoading, isProUnknown, isProRefreshing, refreshPro } = useProStatus()

  const filterParams = { userId: activeUser?.id, period, sport: sport ?? undefined }
  const { data, isLoading, isError, refetch, isRefetching } = useGetEdgeFinder(
    filterParams,
    { query: { enabled: isPro && !!activeUser?.id, queryKey: getGetEdgeFinderQueryKey(filterParams) } }
  )

  // Unfiltered slice just to know which sports exist — keeps the sport
  // dropdown stable while a sport filter is applied.
  const { data: allTime } = useGetEdgeFinder(
    { userId: activeUser?.id },
    { query: { enabled: isPro && !!activeUser?.id, queryKey: getGetEdgeFinderQueryKey({ userId: activeUser?.id }) } }
  )
  const sportOptions = (allTime?.sport ?? []).map((l) => l.key).sort()

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Edge Finder</h1>
        <QueryErrorCard
          title="Your edges didn't load."
          message="Connection hiccup — your lanes are still there. Run it back."
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          testId="card-edge-finder-error"
        />
      </div>
    )
  }

  if (!isPro && !isProLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edge Finder</h1>
          <p className="text-muted-foreground mt-1">
            Your best lanes — by sport, bet type, odds band, and day — cut from your own graded record.
          </p>
        </div>
        {isProUnknown ? (
          // The plan check failed — never pitch an upgrade to someone who may
          // already be paying. Neutral retry instead.
          <QueryErrorCard
            title="Couldn't verify your plan."
            message="Connection hiccup on the billing check — your subscription hasn't gone anywhere."
            onRetry={() => refreshPro()}
            isRetrying={isProRefreshing}
            testId="card-billing-error"
          />
        ) : (
          <UpgradeCard feature="Edge Finder" />
        )}
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Edge Finder</h1>
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse bg-muted/50 h-36" />
          ))}
        </div>
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse bg-muted/50 h-48" />
          ))}
        </div>
      </div>
    )
  }

  const minSample = data.minSample

  const filterBar = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Time window">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            role="tab"
            aria-selected={period === p.value}
            onClick={() => setPeriod(p.value)}
            data-testid={`tab-edge-period-${p.value}`}
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
      {sportOptions.length > 1 && (
        <Select value={sport ?? "__all__"} onValueChange={(v) => setSport(v === "__all__" ? null : v)}>
          <SelectTrigger className="h-9 w-[160px]" data-testid="select-edge-sport">
            <SelectValue placeholder="All sports" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All sports</SelectItem>
            {sportOptions.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => { setPeriod("all"); setSport(null) }}
          data-testid="button-edge-clear-filters"
        >
          Clear filters
        </Button>
      )}
    </div>
  )

  // A filtered slice with nothing in it is not an onboarding problem —
  // keep the filters visible so the bettor can widen the window.
  if (hasFilters && data.settledCount === 0) {
    return (
      <div className="space-y-8 animate-in fade-in-50 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edge Finder</h1>
          <p className="text-muted-foreground mt-1">Where you actually make money — and where you donate it.</p>
        </div>
        {filterBar}
        <Card className="border-dashed border-2 border-muted" data-testid="card-edge-finder-filtered-empty">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <Crosshair className="h-7 w-7 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">Nothing settled in this slice</h2>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                No settled bets match these filters. Widen the window or clear the sport.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!hasFilters && data.settledCount < minSample) {
    return (
      <div className="space-y-8 animate-in fade-in-50 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edge Finder</h1>
          <p className="text-muted-foreground mt-1">Where you actually make money — and where you donate it.</p>
        </div>
        <Card className="border-dashed border-2 border-muted" data-testid="card-edge-finder-empty">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              <Crosshair className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Not enough tape yet</h2>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                Edges show up in settled history, not vibes. Settle at least {minSample} straight bets
                ({data.settledCount} so far) and come back — the numbers will do the talking.
              </p>
            </div>
            <Button asChild>
              <Link href="/bets/new"><Plus className="h-4 w-4 mr-1" />Log a Bet</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const dimensions: Dimension[] = [
    {
      id: "sport",
      title: "By Sport",
      description: "Which leagues pay you and which ones collect from you",
      lanes: data.sport,
      label: (k) => k,
      heroLabel: (k) => `${k} bets`,
      href: (k) => `/bets?mine=1&sport=${encodeURIComponent(k)}`,
    },
    {
      id: "fav-dog",
      title: "Favorites vs Underdogs",
      description: "Chalk eater or dog whisperer — the ledger decides",
      lanes: data.favDog,
      label: (k) => FAV_DOG_LABELS[k] ?? k,
      heroLabel: (k) => FAV_DOG_LABELS[k] ?? k,
    },
    {
      id: "odds-band",
      title: "By Odds Range",
      description: "How you do at each price point",
      lanes: data.oddsBand,
      label: (k) => ODDS_BAND_LABELS[k] ?? k,
      heroLabel: (k) => ODDS_BAND_SHORT[k] ?? k,
    },
    {
      id: "day-of-week",
      title: "By Day of Week",
      description: "Some days you're sharp. Some days you're the entertainment.",
      lanes: data.dayOfWeek,
      label: (k) => DAY_LABELS[k] ?? k,
      heroLabel: (k) => DAY_LABELS[k] ?? k,
    },
    {
      id: "stake-band",
      title: "By Stake Size",
      description: data.avgStake != null
        ? `Relative to your ${formatCurrency(data.avgStake, true)} average stake`
        : "Relative to your average stake",
      lanes: data.stakeBand,
      label: (k) => STAKE_LABELS[k] ?? k,
      heroLabel: (k) => STAKE_LABELS[k]?.toLowerCase() ?? k,
    },
  ]

  // Hero callouts: rank every lane with a real sample across all dimensions.
  const qualified = dimensions.flatMap((d) =>
    d.lanes
      .filter((l) => l.bets >= minSample)
      .map((l) => ({ lane: l, label: d.heroLabel(l.key), dimension: d.title }))
  )
  const best = qualified
    .filter((q) => q.lane.netProfit > 0)
    .sort((a, b) => b.lane.netProfit - a.lane.netProfit)[0]
  const worst = qualified
    .filter((q) => q.lane.netProfit < 0)
    .sort((a, b) => a.lane.netProfit - b.lane.netProfit)[0]

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edge Finder</h1>
        <p className="text-muted-foreground mt-1">Where you actually make money — and where you donate it.</p>
      </div>

      {filterBar}

      {/* Hero callouts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card border-chart-1/30 glow-success" data-testid="card-your-edge">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-chart-1 drop-shadow-[0_0_8px_hsl(var(--chart-1)/0.6)]" />
              <CardTitle className="text-base uppercase tracking-wider text-chart-1 text-glow-success">Your Edge</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {best ? (
              <>
                <div className="text-2xl font-bold" data-testid="text-edge-lane">{best.label}</div>
                <div className="text-3xl font-bold font-mono text-chart-1 text-glow-success mt-1">
                  {signedCurrency(best.lane.netProfit)}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {record(best.lane)} for {best.lane.roi > 0 ? "+" : ""}{best.lane.roi.toFixed(1)}% ROI over {best.lane.bets} bets.
                  This is the lane. Stop leaving it.
                </p>
              </>
            ) : (
              <>
                <div className="text-lg font-semibold text-muted-foreground">No edge found. Yet.</div>
                <p className="text-sm text-muted-foreground mt-2">
                  No lane with {minSample}+ bets is in the green. That's the polite way of saying
                  the book is beating you everywhere. Tighten up.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-chart-2/30 glow-destructive" data-testid="card-money-pit">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-chart-2 drop-shadow-[0_0_8px_hsl(var(--chart-2)/0.6)]" />
              <CardTitle className="text-base uppercase tracking-wider text-chart-2 text-glow-destructive">Your Money Pit</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {worst ? (
              <>
                <div className="text-2xl font-bold" data-testid="text-pit-lane">{worst.label}</div>
                <div className="text-3xl font-bold font-mono text-chart-2 text-glow-destructive mt-1">
                  {signedCurrency(worst.lane.netProfit)}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {record(worst.lane)} across {worst.lane.bets} bets, {worst.lane.roi.toFixed(1)}% ROI.
                  Every crew donates somewhere — this is where you donate.
                </p>
              </>
            ) : (
              <>
                <div className="text-lg font-semibold text-muted-foreground">No money pit found.</div>
                <p className="text-sm text-muted-foreground mt-2">
                  Nothing with {minSample}+ bets is bleeding. Either you're disciplined or you're
                  running hot — the sample will tell on you eventually.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Slice sections */}
      {dimensions.map((dim) => (
        <Card key={dim.id} className="bg-card" data-testid={`card-edge-${dim.id}`}>
          <CardHeader>
            <CardTitle>{dim.title}</CardTitle>
            <CardDescription>{dim.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {dim.lanes.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-md">
                No settled bets in this slice yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
                    <tr>
                      <th className="px-4 py-3 font-medium">Lane</th>
                      <th className="px-4 py-3 font-medium text-right">Bets</th>
                      <th className="px-4 py-3 font-medium text-right">Record</th>
                      <th className="px-4 py-3 font-medium text-right">Wagered</th>
                      <th className="px-4 py-3 font-medium text-right">Net P/L</th>
                      <th className="px-4 py-3 font-medium text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dim.lanes.map((l) => {
                      const smallSample = l.bets < minSample
                      const laneCell = dim.href ? (
                        <Link
                          href={dim.href(l.key)}
                          className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary transition-colors group"
                          data-testid={`link-edge-${dim.id}-${l.key}`}
                        >
                          {dim.label(l.key)}
                          <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      ) : (
                        <span className="font-medium">{dim.label(l.key)}</span>
                      )
                      return (
                        <tr
                          key={l.key}
                          className={`transition-colors hover:bg-muted/50 ${smallSample ? "opacity-45" : ""}`}
                          data-testid={`row-edge-${dim.id}-${l.key}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {laneCell}
                              {smallSample && (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded-full px-1.5 py-0.5"
                                  title={`Under ${minSample} bets — too small to mean anything`}
                                >
                                  <ShieldQuestion className="h-3 w-3" />
                                  small sample
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{l.bets}</td>
                          <td className="px-4 py-3 text-right font-mono">{record(l)}</td>
                          <td className="px-4 py-3 text-right font-mono">{formatCurrency(l.wagered, true)}</td>
                          <td className={`px-4 py-3 text-right font-mono font-bold ${!smallSample && l.netProfit > 0 ? "text-chart-1 text-glow-success" : !smallSample && l.netProfit < 0 ? "text-chart-2 text-glow-destructive" : ""}`}>
                            {signedCurrency(l.netProfit)}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono ${!smallSample && l.roi > 0 ? "text-chart-1" : !smallSample && l.roi < 0 ? "text-chart-2" : ""}`}>
                            {l.roi > 0 ? "+" : ""}{l.roi.toFixed(1)}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        Straight bets only, settled results only. Lanes under {minSample} bets are greyed out because
        five coin flips prove nothing.
      </p>
    </div>
  )
}
