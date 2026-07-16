import { useUser } from "@/contexts/UserContext"
import { listBets, getListBetsQueryKey, exportBetsCsv, type ListBetsParams } from "@workspace/api-client-react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { Link } from "wouter"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatOdds, formatDate } from "@/lib/format"
import { formatOddsAs } from "@workspace/odds"
import { useOddsFormat } from "@/hooks/use-odds-format"
import { isDeadZoneOdds } from "@/lib/odds"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Plus, ClipboardList, AlertTriangle, X } from "lucide-react"
import { ListFilterBar } from "@/components/ListFilterBar"
import { PlayListCard, PlayListCardSkeleton } from "@/components/PlayListCard"
import { ExportCsvButton } from "@/components/ExportCsvButton"
import { useUrlFilters, hasActiveFilters } from "@/hooks/use-url-filters"
import { QueryErrorCard } from "@/components/QueryErrorCard"

const PAGE_SIZE = 25

const DAY_NAMES: Record<string, string> = {
  mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays",
  fri: "Fridays", sat: "Saturdays", sun: "Sundays",
}

const intOrUndef = (s: string) => {
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : undefined
}
const numOrUndef = (s: string) => {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : undefined
}

export default function Bets() {
  const { activeUser } = useUser()
  const [oddsFormat] = useOddsFormat()
  const { filters, update, clear } = useUrlFilters("/bets")
  const filtersActive = hasActiveFilters(filters)

  const params = useMemo<ListBetsParams>(() => ({
    ...(filters.status !== "all" ? { status: filters.status as ListBetsParams["status"] } : {}),
    ...(filters.mine && activeUser ? { userId: activeUser.id } : {}),
    ...(filters.sport ? { sport: filters.sport } : {}),
    ...(filters.sportsbook ? { sportsbook: filters.sportsbook } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.from ? { dateFrom: filters.from } : {}),
    ...(filters.to ? { dateTo: filters.to } : {}),
    ...(intOrUndef(filters.oddsMin) !== undefined ? { oddsMin: intOrUndef(filters.oddsMin) } : {}),
    ...(intOrUndef(filters.oddsMax) !== undefined ? { oddsMax: intOrUndef(filters.oddsMax) } : {}),
    ...(filters.day && DAY_NAMES[filters.day] ? { day: filters.day as ListBetsParams["day"] } : {}),
    ...(numOrUndef(filters.stakeMin) !== undefined ? { stakeMin: numOrUndef(filters.stakeMin) } : {}),
    ...(numOrUndef(filters.stakeMax) !== undefined ? { stakeMax: numOrUndef(filters.stakeMax) } : {}),
  }), [filters, activeUser])

  // Chips for the Edge Finder drill-down filters — they arrive via deep
  // links, so they need a visible, removable representation here.
  const drillChips: { key: string; label: string; remove: () => void }[] = []
  const oddsMinN = intOrUndef(filters.oddsMin)
  const oddsMaxN = intOrUndef(filters.oddsMax)
  if (oddsMinN !== undefined || oddsMaxN !== undefined) {
    const fmt = (n: number) => formatOdds(n)
    const label =
      oddsMinN !== undefined && oddsMaxN !== undefined
        ? `Odds ${fmt(oddsMinN)} to ${fmt(oddsMaxN)}`
        : oddsMinN !== undefined
          ? `Odds ${fmt(oddsMinN)} and longer`
          : `Odds ${fmt(oddsMaxN!)} and heavier`
    drillChips.push({ key: "odds", label, remove: () => update({ oddsMin: "", oddsMax: "" }) })
  }
  if (filters.day && DAY_NAMES[filters.day]) {
    drillChips.push({ key: "day", label: DAY_NAMES[filters.day], remove: () => update({ day: null }) })
  }
  const stakeMinN = numOrUndef(filters.stakeMin)
  const stakeMaxN = numOrUndef(filters.stakeMax)
  if (stakeMinN !== undefined || stakeMaxN !== undefined) {
    const label =
      stakeMinN !== undefined && stakeMaxN !== undefined
        ? `Stake ${formatCurrency(stakeMinN)}–${formatCurrency(stakeMaxN)}`
        : stakeMinN !== undefined
          ? `Stake ${formatCurrency(stakeMinN)}+`
          : `Stake up to ${formatCurrency(stakeMaxN!)}`
    drillChips.push({ key: "stake", label, remove: () => update({ stakeMin: "", stakeMax: "" }) })
  }

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [...getListBetsQueryKey(params), "infinite"],
    queryFn: ({ pageParam }) => listBets({ ...params, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE
        ? allPages.reduce((n, p) => n + p.length, 0)
        : undefined,
  })

  const bets = useMemo(() => data?.pages.flat() ?? [], [data])

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Straight Bets</h1>
          <p className="text-muted-foreground mt-1">Track and review your individual plays.</p>
        </div>
        <div className="flex gap-2">
          <ExportCsvButton fetchCsv={exportBetsCsv} filenameStem="bets" testId="button-export-bets-csv" />
          <Button asChild>
            <Link href="/bets/new">
              <Plus className="mr-2 h-4 w-4" />
              New Bet
            </Link>
          </Button>
        </div>
      </div>

      <ListFilterBar
        filters={filters}
        update={update}
        clear={clear}
        mineLabel="My Bets"
        searchPlaceholder="Search event or pick…"
      />

      {drillChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="row-drilldown-filters">
          {drillChips.map((chip) => (
            <button
              key={chip.key}
              onClick={chip.remove}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border bg-primary/10 text-primary border-primary/40 hover:border-primary transition-colors"
              data-testid={`chip-drilldown-${chip.key}`}
              title="Remove this filter"
            >
              {chip.label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      {isError ? (
        <QueryErrorCard
          title="Your bets didn't load."
          message="Not a bad beat — just a connection problem. Every play is still on the record."
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          testId="card-bets-error"
        />
      ) : !isLoading && bets.length === 0 && !filtersActive ? (
        <Card className="border-dashed border-2 border-muted">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              <ClipboardList className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No bets logged yet</h2>
              <p className="text-muted-foreground text-sm mt-1">Log your first straight bet to start tracking your edge.</p>
            </div>
            <Button asChild>
              <Link href="/bets/new"><Plus className="h-4 w-4 mr-1" />Log First Bet</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
        {/* Narrow screens: stacked cards — no squeezed table, no sideways scrolling */}
        <div className="space-y-2 sm:hidden" data-testid="list-bets-cards">
          {isLoading ? (
            [1, 2, 3].map((i) => <PlayListCardSkeleton key={i} />)
          ) : bets.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                <p>No bets match the current filters.</p>
                <button
                  onClick={clear}
                  className="text-primary text-sm underline-offset-2 hover:underline"
                  data-testid="button-clear-filters-empty-mobile"
                >
                  Clear filters
                </button>
              </CardContent>
            </Card>
          ) : (
            bets.map((bet) => (
              <PlayListCard
                key={bet.id}
                href={`/bets/${bet.id}`}
                title={bet.pick}
                subtitle={`${bet.event} · ${bet.betType}`}
                date={formatDate(bet.gameDate)}
                bettor={bet.userName}
                odds={isDeadZoneOdds(bet.odds) ? formatOdds(bet.odds) : formatOddsAs(bet.odds, oddsFormat)}
                stake={formatCurrency(bet.stake)}
                status={bet.status}
                testId={`card-bet-${bet.id}`}
              />
            ))
          )}
          {!isLoading && bets.length > 0 && hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              data-testid="button-load-more-mobile"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>

        <Card className="overflow-hidden bg-card hidden sm:block">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Bettor</TableHead>
                  <TableHead>Play</TableHead>
                  <TableHead>Odds</TableHead>
                  <TableHead className="text-right">Stake</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [1, 2, 3].map(i => (
                    <TableRow key={i}>
                      <TableCell><div className="h-4 w-20 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-24 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-32 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-12 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto"></div></TableCell>
                      <TableCell><div className="h-6 w-16 bg-muted animate-pulse rounded-full"></div></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                ) : bets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <p>No bets match the current filters.</p>
                        <button
                          onClick={clear}
                          className="text-primary text-sm underline-offset-2 hover:underline"
                          data-testid="button-clear-filters-empty"
                        >
                          Clear filters
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  bets.map(bet => (
                    <TableRow key={bet.id} className="group cursor-pointer hover:bg-muted/50" onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('button')) {
                        window.location.href = `/bets/${bet.id}`
                      }
                    }}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(bet.gameDate)}</TableCell>
                      <TableCell className="font-medium">{bet.userName}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold">{bet.pick}</span>
                          <span className="text-xs text-muted-foreground">{bet.event} · {bet.betType}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">
                        {isDeadZoneOdds(bet.odds) ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-amber-500">{formatOdds(bet.odds)}</span>
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 bg-amber-500/10 text-amber-500 font-sans text-xs gap-1 whitespace-nowrap"
                              title="These odds aren't a real American price. Open the bet to re-enter them."
                            >
                              <AlertTriangle className="h-3 w-3" /> Re-enter odds
                            </Badge>
                          </div>
                        ) : (
                          formatOddsAs(bet.odds, oddsFormat)
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(bet.stake)}</TableCell>
                      <TableCell>
                        <Badge variant={bet.status as any}>{bet.status.toUpperCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">
                          <Link href={`/bets/${bet.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!isLoading && bets.length > 0 && (
            <div className="flex justify-center py-4 border-t border-border/50">
              {hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  data-testid="button-load-more"
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              ) : (
                (data?.pages.length ?? 0) > 1 && (
                  <p className="text-xs text-muted-foreground">That's every bet on the board.</p>
                )
              )}
            </div>
          )}
        </Card>
        </>
      )}
    </div>
  )
}
