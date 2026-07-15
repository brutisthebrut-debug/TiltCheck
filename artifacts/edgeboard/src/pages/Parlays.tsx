import { useUser } from "@/contexts/UserContext"
import { listParlays, getListParlaysQueryKey, exportParlaysCsv, type ListParlaysParams } from "@workspace/api-client-react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { Link } from "wouter"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/format"
import { formatOddsAs } from "@workspace/odds"
import { useOddsFormat } from "@/hooks/use-odds-format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Plus, Layers } from "lucide-react"
import { ListFilterBar } from "@/components/ListFilterBar"
import { PlayListCard, PlayListCardSkeleton } from "@/components/PlayListCard"
import { ExportCsvButton } from "@/components/ExportCsvButton"
import { useUrlFilters, hasActiveFilters } from "@/hooks/use-url-filters"
import { QueryErrorCard } from "@/components/QueryErrorCard"

const PAGE_SIZE = 25

export default function Parlays() {
  const { activeUser } = useUser()
  const [oddsFormat] = useOddsFormat()
  const { filters, update, clear } = useUrlFilters("/parlays")
  const filtersActive = hasActiveFilters(filters)

  const params = useMemo<ListParlaysParams>(() => ({
    ...(filters.status !== "all" ? { status: filters.status as ListParlaysParams["status"] } : {}),
    ...(filters.mine && activeUser ? { userId: activeUser.id } : {}),
    ...(filters.sport ? { sport: filters.sport } : {}),
    ...(filters.sportsbook ? { sportsbook: filters.sportsbook } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.from ? { dateFrom: filters.from } : {}),
    ...(filters.to ? { dateTo: filters.to } : {}),
  }), [filters, activeUser])

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
    queryKey: [...getListParlaysQueryKey(params), "infinite"],
    queryFn: ({ pageParam }) => listParlays({ ...params, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE
        ? allPages.reduce((n, p) => n + p.length, 0)
        : undefined,
  })

  const parlays = useMemo(() => data?.pages.flat() ?? [], [data])

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Parlays</h1>
          <p className="text-muted-foreground mt-1">Track multi-leg bets and longshots.</p>
        </div>
        <div className="flex gap-2">
          <ExportCsvButton fetchCsv={exportParlaysCsv} filenameStem="parlays" testId="button-export-parlays-csv" />
          <Button asChild>
            <Link href="/parlays/new">
              <Plus className="mr-2 h-4 w-4" />
              New Parlay
            </Link>
          </Button>
        </div>
      </div>

      <ListFilterBar
        filters={filters}
        update={update}
        clear={clear}
        mineLabel="My Parlays"
        searchPlaceholder="Search name, event, or pick…"
      />

      {isError ? (
        <QueryErrorCard
          title="Your parlays didn't load."
          message="Not a bad beat — just a connection problem. Every leg is still on the record."
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          testId="card-parlays-error"
        />
      ) : !isLoading && parlays.length === 0 && !filtersActive ? (
        <Card className="border-dashed border-2 border-muted">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              <Layers className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No parlays logged yet</h2>
              <p className="text-muted-foreground text-sm mt-1">Group multiple picks into a parlay to track bigger swings.</p>
            </div>
            <Button asChild>
              <Link href="/parlays/new"><Plus className="h-4 w-4 mr-1" />Log First Parlay</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
        {/* Narrow screens: stacked cards — no squeezed table, no sideways scrolling */}
        <div className="space-y-2 sm:hidden" data-testid="list-parlays-cards">
          {isLoading ? (
            [1, 2, 3].map((i) => <PlayListCardSkeleton key={i} />)
          ) : parlays.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                <p>No parlays match the current filters.</p>
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
            parlays.map((parlay) => (
              <PlayListCard
                key={parlay.id}
                href={`/parlays/${parlay.id}`}
                title={parlay.name}
                subtitle={`${parlay.legs?.length || 0} legs`}
                date={formatDate(parlay.createdAt)}
                bettor={parlay.userName}
                odds={formatOddsAs(parlay.odds, oddsFormat)}
                stake={formatCurrency(parlay.stake)}
                status={parlay.status}
                testId={`card-parlay-${parlay.id}`}
              />
            ))
          )}
          {!isLoading && parlays.length > 0 && hasNextPage && (
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
                  <TableHead>Name</TableHead>
                  <TableHead>Legs</TableHead>
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
                      <TableCell><div className="h-4 w-12 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto"></div></TableCell>
                      <TableCell><div className="h-6 w-16 bg-muted animate-pulse rounded-full"></div></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                ) : parlays.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <p>No parlays match the current filters.</p>
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
                  parlays.map(parlay => (
                    <TableRow key={parlay.id} className="group cursor-pointer hover:bg-muted/50" onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('button')) {
                        window.location.href = `/parlays/${parlay.id}`
                      }
                    }}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(parlay.createdAt)}</TableCell>
                      <TableCell className="font-medium">{parlay.userName}</TableCell>
                      <TableCell className="font-semibold">{parlay.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{parlay.legs?.length || 0} legs</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-primary">{formatOddsAs(parlay.odds, oddsFormat)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(parlay.stake)}</TableCell>
                      <TableCell>
                        <Badge variant={parlay.status as any}>{parlay.status.toUpperCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">
                          <Link href={`/parlays/${parlay.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!isLoading && parlays.length > 0 && (
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
                  <p className="text-xs text-muted-foreground">That's every parlay on the board.</p>
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
