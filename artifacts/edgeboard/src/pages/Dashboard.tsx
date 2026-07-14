import { useUser } from "@/contexts/UserContext"
import { 
  useGetStatsSummary, 
  useGetRecentActivity,
  useGetBankroll,
  useListBets,
  useListParlays,
  useGetNeedsSettling,
  useGetStreaks,
  useGetUserBadges,
  getGetStreaksQueryKey,
  getGetUserBadgesQueryKey,
  getGetStatsSummaryQueryKey,
  getGetRecentActivityQueryKey,
  getGetBankrollQueryKey,
  getListBetsQueryKey,
  getListParlaysQueryKey,
  getGetNeedsSettlingQueryKey,
} from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InviteCard } from "@/components/InviteCard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatOdds } from "@/lib/format"
import { Link } from "wouter"
import { Activity, Flame, Snowflake, TrendingUp, TrendingDown, Target, CalendarDays, DollarSign, Star, ClipboardList, Plus, AlarmClock, Layers, NotebookPen, Trophy } from "lucide-react"
import { formatDate } from "@/lib/format"

export default function Dashboard() {
  const { activeUser, isLoading: isUserLoading } = useUser();

  const { data: stats, isLoading: isStatsLoading } = useGetStatsSummary(
    { userId: activeUser?.id }, 
    { query: { enabled: !!activeUser?.id, queryKey: getGetStatsSummaryQueryKey({ userId: activeUser?.id }) } }
  );

  const { data: activity = [], isLoading: isActivityLoading } = useGetRecentActivity(
    { limit: 5 },
    { query: { enabled: !!activeUser?.id, queryKey: getGetRecentActivityQueryKey({ limit: 5 }) } }
  );

  const { data: bankroll, isLoading: isBankrollLoading } = useGetBankroll(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetBankrollQueryKey({ userId: activeUser?.id }) } }
  );

  const { data: pendingBets = [] } = useListBets(
    { userId: activeUser?.id, status: 'pending', limit: 200 },
    { query: { enabled: !!activeUser?.id, queryKey: [...getListBetsQueryKey({ userId: activeUser?.id }), 'pending'] } }
  );

  const { data: pendingParlays = [] } = useListParlays(
    { userId: activeUser?.id, status: 'pending', limit: 200 },
    { query: { enabled: !!activeUser?.id, queryKey: [...getListParlaysQueryKey({ userId: activeUser?.id }), 'pending'] } }
  );

  const { data: needsSettling } = useGetNeedsSettling(
    { query: { enabled: !!activeUser?.id, queryKey: getGetNeedsSettlingQueryKey() } }
  );

  const { data: streaks } = useGetStreaks(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetStreaksQueryKey({ userId: activeUser?.id }) } }
  );

  const { data: badges = [] } = useGetUserBadges(
    activeUser?.id ?? 0,
    { query: { enabled: !!activeUser?.id, queryKey: getGetUserBadgesQueryKey(activeUser?.id ?? 0) } }
  );
  const earnedBadges = badges.filter(b => b.earnedAt != null);

  const isLoading = isUserLoading || isStatsLoading || isActivityLoading || isBankrollLoading;

  const today = new Date().toISOString().split('T')[0];
  const allPending = [
    ...pendingBets.map(b => ({ ...b, _type: 'bet' as const })),
    ...pendingParlays.map(p => ({ ...p, _type: 'parlay' as const, pick: p.name, event: p.legs?.[0]?.event ?? p.name })),
  ];
  const totalExposure = allPending.reduce((sum, p) => sum + Number(p.stake), 0);
  const highestConf = allPending.reduce<typeof allPending[0] | null>((best, p) => 
    best === null || p.confidenceScore > best.confidenceScore ? p : best, null
  );
  const todayEvents = pendingBets.filter(b => b.gameDate === today).length 
    + pendingParlays.filter(p => p.legs?.some(l => l.gameDate === today)).length;

  const totalBets = (stats?.wins ?? 0) + (stats?.losses ?? 0) + (stats?.pushes ?? 0) + (stats?.pending ?? 0);
  const hasData = totalBets > 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => (
            <Card key={i} className="animate-pulse bg-muted/50 h-32" />
          ))}
        </div>
      </div>
    )
  }

  if (!activeUser) return null;

  if (!hasData) {
    return (
      <div className="space-y-8 animate-in fade-in-50 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Welcome back, {activeUser.displayName}.</p>
        </div>
        <Card className="border-dashed border-2 border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-6 text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <ClipboardList className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Your board is empty — for now</h2>
              <p className="text-muted-foreground mt-1 max-w-sm">
                Log your first play and this turns into your cockpit.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg">
              <div className="flex flex-col items-center gap-1.5 p-4 rounded-lg bg-background/60 border border-border/50">
                <Target className="h-5 w-5 text-primary" />
                <div className="text-sm font-medium">Your record</div>
                <div className="text-xs text-muted-foreground">Wins, losses, and streaks as you grade bets</div>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-4 rounded-lg bg-background/60 border border-border/50">
                <DollarSign className="h-5 w-5 text-primary" />
                <div className="text-sm font-medium">Bankroll & ROI</div>
                <div className="text-xs text-muted-foreground">Every result moves your running balance</div>
              </div>
              <div className="flex flex-col items-center gap-1.5 p-4 rounded-lg bg-background/60 border border-border/50">
                <Flame className="h-5 w-5 text-primary" />
                <div className="text-sm font-medium">Honest insights</div>
                <div className="text-xs text-muted-foreground">Where you win, where you leak money</div>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap justify-center">
              <Button asChild data-testid="button-empty-log-bet">
                <Link href="/bets/new"><Plus className="h-4 w-4 mr-1" />Log First Bet</Link>
              </Button>
              <Button asChild variant="outline" data-testid="button-empty-log-parlay">
                <Link href="/parlays/new"><Plus className="h-4 w-4 mr-1" />Log First Parlay</Link>
              </Button>
            </div>
            <Link href="/bankroll" className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline" data-testid="link-empty-bankroll">
              Set or adjust your starting bankroll first →
            </Link>
          </CardContent>
        </Card>
        <InviteCard />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back, {activeUser.displayName}. Here's your edge today.</p>
      </div>

      {/* Habit streaks — showing up and grading honestly, gamified */}
      {streaks && (
        <div className="grid grid-cols-2 gap-3" data-testid="streak-strip">
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${streaks.loggingStreakDays > 0 ? 'bg-orange-500/15' : 'bg-muted'}`}>
              <Flame className={`h-5 w-5 ${streaks.loggingStreakDays > 0 ? 'text-orange-500' : 'text-muted-foreground'}`} />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-lg font-bold leading-tight" data-testid="text-logging-streak">
                {streaks.loggingStreakDays} {streaks.loggingStreakDays === 1 ? 'day' : 'days'}
              </div>
              <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                Logging streak{streaks.longestLoggingStreakDays > streaks.loggingStreakDays ? ` · best ${streaks.longestLoggingStreakDays}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${streaks.overdueCount === 0 ? 'bg-primary/15' : 'bg-amber-500/15'}`}>
              <NotebookPen className={`h-5 w-5 ${streaks.overdueCount === 0 ? 'text-primary' : 'text-amber-500'}`} />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-lg font-bold leading-tight" data-testid="text-settle-streak">
                {streaks.overdueCount > 0
                  ? `${streaks.overdueCount} overdue`
                  : `${streaks.settleStreakDays} ${streaks.settleStreakDays === 1 ? 'day' : 'days'}`}
              </div>
              <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                {streaks.overdueCount > 0 ? 'Grade them to restart the streak' : 'Everything graded'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Needs settling — overdue pending plays. Hidden when settled up. */}
      {needsSettling && needsSettling.count > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5" data-testid="card-needs-settling">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlarmClock className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-base">
                {needsSettling.count} {needsSettling.count === 1 ? 'play needs' : 'plays need'} settling
              </CardTitle>
            </div>
            <CardDescription>These games are over — grade them to keep your record honest.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {needsSettling.bets.map((bet) => (
              <div
                key={`bet-${bet.id}`}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background/60 border border-border/50"
                data-testid={`row-needs-settling-bet-${bet.id}`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{bet.pick}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {bet.event} · {formatDate(bet.gameDate)} · {formatCurrency(bet.stake)} at stake
                  </div>
                </div>
                <Button asChild size="sm" className="shrink-0" data-testid={`button-settle-bet-${bet.id}`}>
                  <Link href={`/bets/${bet.id}`}>Settle</Link>
                </Button>
              </div>
            ))}
            {needsSettling.parlays.map((parlay) => (
              <div
                key={`parlay-${parlay.id}`}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-background/60 border border-border/50"
                data-testid={`row-needs-settling-parlay-${parlay.id}`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {parlay.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {parlay.legs?.length ?? 0} legs · {formatCurrency(parlay.stake)} at stake
                  </div>
                </div>
                <Button asChild size="sm" className="shrink-0" data-testid={`button-settle-parlay-${parlay.id}`}>
                  <Link href={`/parlays/${parlay.id}`}>Settle</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Bankroll</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">
              {formatCurrency(bankroll?.currentBalance ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              {stats && stats.totalProfit >= 0 ? (
                <span className="text-green-500 flex items-center"><TrendingUp className="h-3 w-3 mr-1"/>{formatCurrency(stats.totalProfit)} all-time</span>
              ) : (
                <span className="text-red-500 flex items-center"><TrendingDown className="h-3 w-3 mr-1"/>{formatCurrency(stats?.totalProfit ?? 0)} all-time</span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {(stats?.winRate ?? 0).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.wins}-{stats?.losses}{stats?.pushes ? `-${stats.pushes}` : ''} Record
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ROI</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${stats && stats.roi > 0 ? 'text-green-500' : stats && stats.roi < 0 ? 'text-red-500' : ''}`}>
              {stats?.roi != null && stats.roi > 0 ? '+' : ''}{(stats?.roi ?? 0).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              On {formatCurrency(stats?.totalWagered ?? 0)} total wagered
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Streak</CardTitle>
            {stats?.currentStreakType === 'win' ? (
              <Flame className="h-4 w-4 text-orange-500" />
            ) : stats?.currentStreakType === 'loss' ? (
              <Snowflake className="h-4 w-4 text-blue-400" />
            ) : (
              <Activity className="h-4 w-4 text-muted-foreground" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {stats?.currentStreak ?? 0} {stats?.currentStreakType === 'win' ? 'W' : stats?.currentStreakType === 'loss' ? 'L' : ''}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Longest W: {stats?.longestWinStreak ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Activity */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest plays from your workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activity.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
                  No recent activity
                </div>
              ) : (
                activity.map((item) => (
                  <div key={item.id} className="flex items-start justify-between border-b border-border/50 pb-4 last:border-0 last:pb-0">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{item.userName}</span>
                        <span className="text-muted-foreground text-sm">
                          {item.type === 'parlay' ? 'placed a parlay' : `bet ${item.sport}`}
                        </span>
                      </div>
                      <p className="text-sm">{item.description}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                        <span>{formatCurrency(item.stake, false)}</span>
                        {item.profit !== null && item.profit !== undefined && (
                          <span className={item.profit > 0 ? "text-green-500" : item.profit < 0 ? "text-red-500" : ""}>
                            {item.profit > 0 ? '+' : ''}{formatCurrency(item.profit, false)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant={item.status as any}>{item.status.toUpperCase()}</Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Today's Decisions */}
        <Card className="col-span-1 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Today's Decisions</CardTitle>
            <CardDescription>Pending plays requiring your attention</CardDescription>
          </CardHeader>
          <CardContent>
            {allPending.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-center border border-dashed border-primary/30 rounded-md">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                  <Target className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">All settled up</p>
                  <p className="text-xs text-muted-foreground mt-1">No pending bets or parlays</p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/bets/new"><Plus className="h-3 w-3 mr-1" />Log a bet</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col items-center p-3 rounded-lg bg-background/60 border border-border/50 text-center">
                    <ClipboardList className="h-4 w-4 text-primary mb-1" />
                    <div className="text-xl font-bold font-mono">{allPending.length}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Pending</div>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-background/60 border border-border/50 text-center">
                    <DollarSign className="h-4 w-4 text-amber-500 mb-1" />
                    <div className="text-lg font-bold font-mono">{formatCurrency(totalExposure, false)}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Exposure</div>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-background/60 border border-border/50 text-center">
                    <CalendarDays className="h-4 w-4 text-blue-400 mb-1" />
                    <div className="text-xl font-bold font-mono">{todayEvents}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Today</div>
                  </div>
                </div>

                {/* Top confidence play */}
                {highestConf && (
                  <div className="p-3 rounded-lg bg-background/60 border border-primary/30 space-y-1">
                    <div className="flex items-center gap-1 text-[10px] text-primary uppercase tracking-wider font-semibold">
                      <Star className="h-3 w-3 fill-primary" /> Top Conviction Play
                    </div>
                    <div className="font-semibold text-sm truncate">
                      {highestConf._type === 'bet' ? (highestConf as any).pick : (highestConf as any).name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{highestConf.event}</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-primary">{highestConf.confidenceScore}/10 confidence</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-mono">{formatCurrency(Number(highestConf.stake))} at stake</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline" className="flex-1 text-xs">
                    <Link href="/bets">Grade Bets</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="flex-1 text-xs">
                    <Link href="/parlays">Grade Parlays</Link>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Badge case — earned bright, the rest as goals to chase */}
      {badges.length > 0 && (
        <Card data-testid="card-badge-case">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Badge Case</CardTitle>
            </div>
            <CardDescription>
              {earnedBadges.length} of {badges.length} earned — all from plays you already log.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {badges.map((b) => (
                <div
                  key={b.id}
                  data-testid={`badge-${b.id}`}
                  title={b.description}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${
                    b.earnedAt
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border/50 bg-background/40 opacity-45 grayscale'
                  }`}
                >
                  <span className="text-xl leading-none">{b.emoji}</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">{b.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {b.earnedAt ? formatDate(b.earnedAt) : 'Locked'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <InviteCard />
    </div>
  )
}
