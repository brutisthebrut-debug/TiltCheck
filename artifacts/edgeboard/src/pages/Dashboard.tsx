import { useEffect, useState } from "react"
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
  useGetLeakProfile,
  useMarkLeakCelebrationSeen,
  getGetLeakProfileQueryKey,
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
import { UpgradeCard } from "@/components/UpgradeCard"
import { useProStatus } from "@/hooks/use-pro"
import { QueryErrorCard } from "@/components/QueryErrorCard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatOdds } from "@/lib/format"
import { Link } from "wouter"
import { Activity, Flame, Snowflake, TrendingUp, TrendingDown, Target, CalendarDays, DollarSign, Star, ClipboardList, Plus, AlarmClock, Layers, NotebookPen, Trophy, Newspaper, ArrowRight, AlertTriangle, WifiOff, RotateCw } from "lucide-react"
import { formatDate } from "@/lib/format"
import { isRecapUnseen } from "@/lib/recapTeaser"
import { dayOf } from "@workspace/weeks"

const MISS_REASON_LABELS: Record<string, string> = {
  bad_read: "Bad read",
  bad_price: "Bad price",
  lineup_injury: "Lineup / injury news",
  emotional: "Emotional bet",
  misunderstood_market: "Misunderstood market",
}

export default function Dashboard() {
  const { activeUser, isLoading: isUserLoading } = useUser();

  const { data: stats, isLoading: isStatsLoading, isError: isStatsError, refetch: refetchStats, isRefetching: isStatsRefetching } = useGetStatsSummary(
    { userId: activeUser?.id }, 
    { query: { enabled: !!activeUser?.id, queryKey: getGetStatsSummaryQueryKey({ userId: activeUser?.id }) } }
  );

  const { data: activity = [], isLoading: isActivityLoading, isError: isActivityError, refetch: refetchActivity, isRefetching: isActivityRefetching } = useGetRecentActivity(
    { limit: 5 },
    { query: { enabled: !!activeUser?.id, queryKey: getGetRecentActivityQueryKey({ limit: 5 }) } }
  );

  const { data: bankroll, isLoading: isBankrollLoading, isError: isBankrollError, refetch: refetchBankroll, isRefetching: isBankrollRefetching } = useGetBankroll(
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

  // Judge "the game is over" by the bettor's own day, not UTC midnight.
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data: needsSettling, isError: isNeedsSettlingError, refetch: refetchNeedsSettling, isRefetching: isNeedsSettlingRefetching } = useGetNeedsSettling(
    { tz: browserTz },
    { query: { enabled: !!activeUser?.id, queryKey: getGetNeedsSettlingQueryKey({ tz: browserTz }) } }
  );

  const { data: streaks, isError: isStreaksError, refetch: refetchStreaks, isRefetching: isStreaksRefetching } = useGetStreaks(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetStreaksQueryKey({ userId: activeUser?.id }) } }
  );

  const { data: badges = [], isError: isBadgesError, refetch: refetchBadges, isRefetching: isBadgesRefetching } = useGetUserBadges(
    activeUser?.id ?? 0,
    { query: { enabled: !!activeUser?.id, queryKey: getGetUserBadgesQueryKey(activeUser?.id ?? 0) } }
  );
  const earnedBadges = badges.filter(b => b.earnedAt != null);

  // Leak read + tilt check are Pro surfaces — the query stays off for free
  // accounts so the 402 never hits the retry-card machinery.
  const { isPro, isProLoading, isProUnknown } = useProStatus();
  const { data: leakProfile, isError: isLeakProfileError, refetch: refetchLeakProfile, isRefetching: isLeakProfileRefetching } = useGetLeakProfile(
    { userId: activeUser?.id },
    { query: { enabled: isPro && !!activeUser?.id, queryKey: getGetLeakProfileQueryKey({ userId: activeUser?.id }), staleTime: 60_000 } }
  );

  // The smaller widgets normally hide themselves when they have nothing to
  // show — which means a failed fetch would make them vanish silently. Name
  // what's missing and offer one retry for all of it.
  const failedWidgets = [
    isStreaksError && "streaks",
    isNeedsSettlingError && "needs settling",
    isBadgesError && "badges",
    isLeakProfileError && "your leak read",
  ].filter((w): w is string => typeof w === "string");
  const isWidgetRetrying = isStreaksRefetching || isNeedsSettlingRefetching || isBadgesRefetching || isLeakProfileRefetching;
  const retryFailedWidgets = () => {
    if (isStreaksError) refetchStreaks();
    if (isNeedsSettlingError) refetchNeedsSettling();
    if (isBadgesError) refetchBadges();
    if (isLeakProfileError) refetchLeakProfile();
  };

  // The single most damaging qualifying leak. Mirrors the bet-form priority,
  // minus chasing (that one only means something at bet time): worst sport by
  // net dollars, then the repeated self-graded miss reason, then the
  // overconfidence gap. Server thresholds decide what qualifies — anything
  // present here is a real pattern, not noise.
  const topLeak = (() => {
    if (!leakProfile) return null;
    const windowDays = leakProfile.recentWindowDays;
    if (leakProfile.worstSport) {
      const { sport, netLoss, bets, recentNet, recentBets } = leakProfile.worstSport;
      const trend =
        recentBets === 0
          ? { improving: true, text: `No ${sport} bets settled in the last ${windowDays} days — the leak's gone quiet.` }
          : recentNet >= 0
            ? { improving: true, text: `Up ${formatCurrency(recentNet)} on ${sport} over the last ${windowDays} days — slowing down.` }
            : { improving: false, text: `${formatCurrency(recentNet)} more over the last ${windowDays} days — still bleeding.` };
      return {
        key: "worst-sport",
        label: `${sport} keeps cashing your checks`,
        figure: formatCurrency(netLoss),
        line: `${bets} settled ${sport} bets, and the book is still up on you. Your most expensive habit has a name.`,
        trend,
        href: `/bets?mine=1&sport=${encodeURIComponent(sport)}`,
        cta: `See the ${sport} damage`,
      };
    }
    if (leakProfile.topMissReason) {
      const { reason, count, netLoss, recentCount, recentNetLoss } = leakProfile.topMissReason;
      const label = MISS_REASON_LABELS[reason] ?? reason;
      const trend =
        recentCount === 0
          ? { improving: true, text: `Zero "${label.toLowerCase()}" losses in the last ${windowDays} days — slowing down.` }
          : {
              improving: false,
              text: `${recentCount} more (${formatCurrency(-recentNetLoss)}) in the last ${windowDays} days — still bleeding.`,
            };
      return {
        key: "miss-reason",
        label: `"${label}" — again`,
        figure: formatCurrency(-netLoss),
        line: `You've graded ${count} losses "${label.toLowerCase()}". Once is a bad night. ${count} times is a pattern.`,
        trend,
        href: "/stats",
        cta: "See the full pattern",
      };
    }
    if (leakProfile.overconfidence) {
      const { winRate, sample, recentWinRate, recentSample } = leakProfile.overconfidence;
      const trend =
        recentSample === 0 || recentWinRate == null
          ? { improving: true, text: `No 7+ confidence plays settled in the last ${windowDays} days — the leak's gone quiet.` }
          : recentWinRate > winRate
            ? { improving: true, text: `Hitting ${recentWinRate}% over the last ${windowDays} days — slowing down.` }
            : { improving: false, text: `${recentWinRate}% over ${recentSample} in the last ${windowDays} days — still bleeding.` };
      return {
        key: "overconfidence",
        label: "Your confidence is writing checks",
        figure: `${winRate}%`,
        line: `That's how your 7+ confidence picks actually hit, over ${sample} of them. The swagger isn't cashing.`,
        trend,
        href: "/stats",
        cta: "See the numbers",
      };
    }
    return null;
  })();

  // One-time trend-flip celebration: the server reports trendFlip while the
  // celebration is still unseen, and we consume it with an explicit POST only
  // once the celebratory card actually renders — so other leak-profile
  // consumers (like the bet form) can never burn it silently. Latched in
  // state so the card stays celebratory for this visit even after the ack
  // makes later responses report false.
  const trendFlipAvailable = !!leakProfile?.trendFlip && !!topLeak?.trend.improving;
  const [leakCelebrating, setLeakCelebrating] = useState(false);
  const { mutate: markLeakCelebrationSeen } = useMarkLeakCelebrationSeen();

  const isLoading = isUserLoading || isStatsLoading || isActivityLoading || isBankrollLoading;
  const isError = isStatsError || isActivityError || isBankrollError;
  const isRetrying = isStatsRefetching || isActivityRefetching || isBankrollRefetching;
  const retry = () => {
    if (isStatsError) refetchStats();
    if (isActivityError) refetchActivity();
    if (isBankrollError) refetchBankroll();
  };

  const today = dayOf(new Date());
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

  // Weekly recap teaser — shows once per week until the recap is opened.
  // Seen state comes from the server (per user), so it holds across devices.
  const recapUnseen = !!activeUser && isRecapUnseen(activeUser.recapSeenWeek);

  // Ack the trend-flip celebration only when the celebratory card is actually
  // on screen (not during loading/error/empty states, which never render it).
  const leakCardOnScreen = !!topLeak && !!activeUser && !isLoading && !isError && hasData;
  useEffect(() => {
    if (trendFlipAvailable && leakCardOnScreen && !leakCelebrating) {
      setLeakCelebrating(true);
      markLeakCelebrationSeen();
    }
  }, [trendFlipAvailable, leakCardOnScreen, leakCelebrating, markLeakCelebrationSeen]);

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <QueryErrorCard
          title="The dashboard didn't load."
          message="Not a bad beat — just a connection problem. Your numbers are safe."
          onRetry={retry}
          isRetrying={isRetrying}
          testId="card-dashboard-error"
        />
      </div>
    )
  }

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

      {/* Some smaller widgets hide themselves when empty — if their data
          failed to load, say so instead of letting them vanish silently. */}
      {failedWidgets.length > 0 && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-muted bg-card px-4 py-3"
          role="alert"
          data-testid="card-widget-retry"
        >
          <div className="flex min-w-0 items-center gap-3">
            <WifiOff className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 text-sm text-muted-foreground">
              Couldn't load {failedWidgets.join(", ")} — the rest of the board is live.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            data-testid="card-widget-retry-button"
            disabled={isWidgetRetrying}
            onClick={retryFailedWidgets}
          >
            <RotateCw className={`h-4 w-4 mr-2 ${isWidgetRetrying ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </div>
      )}

      {/* Habit streaks — showing up and grading honestly, gamified */}
      {streaks && (
        <div className="grid grid-cols-2 gap-4" data-testid="streak-strip">
          <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-all ${streaks.loggingStreakDays > 0 ? 'border-[#ff9900]/50 bg-[#ff9900]/10 glow-amber' : 'border-border/60 bg-card'}`}>
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${streaks.loggingStreakDays > 0 ? 'bg-[#ff9900]/20' : 'bg-muted'}`}>
              <Flame className={`h-5 w-5 ${streaks.loggingStreakDays > 0 ? 'text-[#ff9900] drop-shadow-[0_0_8px_rgba(255,153,0,0.8)]' : 'text-muted-foreground'}`} />
            </div>
            <div className="min-w-0">
              <div className={`font-mono text-xl font-bold leading-tight ${streaks.loggingStreakDays > 0 ? 'text-[#ff9900] text-glow-warning' : ''}`} data-testid="text-logging-streak">
                {streaks.loggingStreakDays} {streaks.loggingStreakDays === 1 ? 'day' : 'days'}
              </div>
              <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                Logging streak{streaks.longestLoggingStreakDays > streaks.loggingStreakDays ? ` · best ${streaks.longestLoggingStreakDays}` : ''}
              </div>
            </div>
          </div>
          <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-all ${streaks.overdueCount > 0 ? 'border-chart-2/50 bg-chart-2/10 glow-destructive' : 'border-primary/40 bg-primary/10 glow-primary'}`}>
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${streaks.overdueCount === 0 ? 'bg-primary/20' : 'bg-chart-2/20'}`}>
              <NotebookPen className={`h-5 w-5 ${streaks.overdueCount === 0 ? 'text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]' : 'text-chart-2 drop-shadow-[0_0_8px_hsl(var(--chart-2)/0.6)]'}`} />
            </div>
            <div className="min-w-0">
              <div className={`font-mono text-xl font-bold leading-tight ${streaks.overdueCount > 0 ? 'text-chart-2 text-glow-destructive' : 'text-primary text-glow-primary'}`} data-testid="text-settle-streak">
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

      {/* Weekly recap teaser */}
      {recapUnseen && (
        <Link href="/recap" data-testid="card-recap-teaser" className="block">
          <Card className="border-chart-5/50 bg-chart-5/10 glow-purple transition-all duration-300 hover:scale-[1.01] hover:bg-chart-5/20 cursor-pointer relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-chart-5/10 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
            <CardContent className="flex items-center gap-4 py-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-chart-5/20 ring-1 ring-chart-5/50">
                <Newspaper className="h-6 w-6 text-chart-5 drop-shadow-[0_0_8px_hsl(var(--chart-5)/0.8)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold text-glow-purple text-chart-5">Your weekly tape is ready</div>
                <div className="text-xs text-foreground/80 mt-1">
                  Last week's wins, leaks, and the crew's highlights — plainly stated.
                </div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-chart-5" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Needs settling — overdue pending plays. Hidden when settled up. */}
      {needsSettling && needsSettling.count > 0 && (
        <Card className="border-[#ff9900]/40 bg-[#ff9900]/10 glow-amber" data-testid="card-needs-settling">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlarmClock className="h-5 w-5 text-[#ff9900] drop-shadow-[0_0_8px_rgba(255,153,0,0.8)]" />
              <CardTitle className="text-base text-[#ff9900] text-glow-warning">
                {needsSettling.count} {needsSettling.count === 1 ? 'play needs' : 'plays need'} settling
              </CardTitle>
            </div>
            <CardDescription className="text-foreground/80">These games are over — grade them to keep your record honest.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {needsSettling.bets.map((bet) => (
              <div
                key={`bet-${bet.id}`}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-card border border-border/80"
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
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-card border border-border/80"
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

      {/* Tilt spiral — the "right now" alarm. Losses landed, the plays got
          fast and big. Outranks the slow-burn leak card below because this
          one is happening tonight. */}
      {leakProfile?.tiltSpiral && (
        <Card
          className="border-chart-2/60 bg-chart-2/15 glow-destructive"
          data-testid="card-tilt-spiral"
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-chart-2 drop-shadow-[0_0_8px_hsl(var(--chart-2)/0.8)]" />
              <CardTitle className="text-base text-chart-2 text-glow-destructive">Tilt Check</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-foreground">
              {leakProfile.tiltSpiral.recentLosses} Ls in the last {leakProfile.tiltSpiral.windowHours} hours,{" "}
              {leakProfile.tiltSpiral.rapidPlays} quick plays since — staked{" "}
              {leakProfile.tiltSpiral.stakeRatio}x your usual ({formatCurrency(leakProfile.tiltSpiral.burstAvgStake)} a pop).
            </p>
            <p className="text-sm text-muted-foreground">
              That's the tilt playbook, and the book wrote it. Close the app, take the walk — the board will still be here tomorrow.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Free accounts see the velvet rope where the leak read would sit.
          If the plan check itself failed, show nothing — never pitch an
          upgrade to someone who may already be paying. */}
      {!isPro && !isProLoading && !isProUnknown && (
        <UpgradeCard compact feature="Your leak read" />
      )}

      {/* Your Leak — the one recurring mistake that's costing real money.
          Absent entirely when no signal clears the server's thresholds. */}
      {topLeak && (
        <Link href={topLeak.href} data-testid={`link-your-leak-${topLeak.key}`}>
          <Card
            className={`transition-all duration-300 hover:scale-[1.01] cursor-pointer ${
              leakCelebrating
                ? "border-chart-1/50 bg-chart-1/10 glow-success hover:bg-chart-1/15"
                : "border-chart-2/40 bg-chart-2/10 glow-destructive hover:bg-chart-2/15"
            }`}
            data-testid="card-your-leak"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                {leakCelebrating ? (
                  <Trophy className="h-5 w-5 text-chart-1 drop-shadow-[0_0_8px_hsl(var(--chart-1)/0.8)]" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-chart-2 drop-shadow-[0_0_8px_hsl(var(--chart-2)/0.8)]" />
                )}
                <CardTitle className={`text-base ${leakCelebrating ? "text-chart-1 text-glow-success" : "text-chart-2 text-glow-destructive"}`}>
                  Your Leak
                </CardTitle>
                {leakCelebrating && (
                  <Badge
                    className="border-chart-1/50 bg-chart-1/15 text-chart-1 text-glow-success"
                    variant="outline"
                    data-testid="badge-leak-trend-flip"
                  >
                    Trend flipped
                  </Badge>
                )}
              </div>
              <CardDescription className="text-foreground/80">{topLeak.label}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <div className="text-3xl font-bold font-mono text-chart-2 text-glow-destructive" data-testid="text-leak-figure">
                  {topLeak.figure}
                </div>
                <p className="text-sm text-foreground/80 mt-1">{topLeak.line}</p>
                <p
                  className={`text-xs font-semibold mt-2 flex items-center gap-1.5 ${
                    topLeak.trend.improving
                      ? "text-chart-1 text-glow-success"
                      : "text-chart-2 text-glow-destructive"
                  }`}
                  data-testid="text-leak-trend"
                >
                  {topLeak.trend.improving ? (
                    <TrendingUp className="h-3.5 w-3.5 shrink-0 drop-shadow-[0_0_6px_hsl(var(--chart-1)/0.8)]" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 shrink-0 drop-shadow-[0_0_6px_hsl(var(--chart-2)/0.8)]" />
                  )}
                  {topLeak.trend.text}
                </p>
                {leakCelebrating && (
                  <p className="text-xs text-chart-1 text-glow-success mt-2" data-testid="text-leak-trend-flip">
                    First green window since this leak showed up. That's the whole point — keep it boring.
                  </p>
                )}
              </div>
              <div className={`shrink-0 self-end sm:self-auto flex items-center gap-1 text-xs whitespace-nowrap ${leakCelebrating ? "text-chart-1" : "text-chart-2"}`}>
                {topLeak.cta}
                <ArrowRight className="h-4 w-4" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Bankroll</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary text-glow-primary">
              {formatCurrency(bankroll?.currentBalance ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              {stats && stats.totalProfit >= 0 ? (
                <span className="text-chart-1 flex items-center text-glow-success"><TrendingUp className="h-3 w-3 mr-1"/>{formatCurrency(stats.totalProfit)} all-time</span>
              ) : (
                <span className="text-chart-2 flex items-center text-glow-destructive"><TrendingDown className="h-3 w-3 mr-1"/>{formatCurrency(stats?.totalProfit ?? 0)} all-time</span>
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
            <div className={`text-2xl font-bold font-mono ${stats && stats.roi > 0 ? 'text-chart-1 text-glow-success' : stats && stats.roi < 0 ? 'text-chart-2 text-glow-destructive' : ''}`}>
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
              <Flame className="h-4 w-4 text-[#ff9900] drop-shadow-[0_0_6px_rgba(255,153,0,0.8)]" />
            ) : stats?.currentStreakType === 'loss' ? (
              <Snowflake className="h-4 w-4 text-chart-3 drop-shadow-[0_0_6px_hsl(var(--chart-3)/0.8)]" />
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
                          <span className={item.profit > 0 ? "text-chart-1 font-bold" : item.profit < 0 ? "text-chart-2 font-bold" : ""}>
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
                  <div className="flex flex-col items-center p-3 rounded-lg bg-card border border-border/80 text-center">
                    <ClipboardList className="h-4 w-4 text-primary mb-1" />
                    <div className="text-xl font-bold font-mono">{allPending.length}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Pending</div>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-card border border-border/80 text-center">
                    <DollarSign className="h-4 w-4 text-[#ff9900] mb-1" />
                    <div className="text-lg font-bold font-mono">{formatCurrency(totalExposure, false)}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Exposure</div>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-card border border-border/80 text-center">
                    <CalendarDays className="h-4 w-4 text-chart-3 mb-1" />
                    <div className="text-xl font-bold font-mono">{todayEvents}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Today</div>
                  </div>
                </div>

                {/* Top confidence play */}
                {highestConf && (
                  <div className="p-4 rounded-lg bg-primary/10 border border-primary/40 space-y-1 glow-primary transition-all">
                    <div className="flex items-center gap-1 text-[10px] text-primary uppercase tracking-wider font-bold">
                      <Star className="h-3.5 w-3.5 fill-primary drop-shadow-[0_0_4px_hsl(var(--primary)/0.8)]" /> Top Conviction Play
                    </div>
                    <div className="font-bold text-sm truncate pt-1">
                      {highestConf._type === 'bet' ? (highestConf as any).pick : (highestConf as any).name}
                    </div>
                    <div className="text-xs text-foreground/80 truncate">{highestConf.event}</div>
                    <div className="flex items-center gap-2 text-xs mt-1">
                      <span className="font-mono font-bold text-primary">{highestConf.confidenceScore}/10 confidence</span>
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
                  className={`flex items-center gap-3 rounded-lg border px-3 py-3 transition-all ${
                    b.earnedAt
                      ? 'border-yellow-500/50 bg-yellow-500/10 glow-amber hover:scale-105'
                      : 'border-border/50 bg-card opacity-40 grayscale'
                  }`}
                >
                  <span className={`text-2xl leading-none ${b.earnedAt ? 'drop-shadow-[0_0_8px_rgba(234,179,8,0.6)]' : ''}`}>{b.emoji}</span>
                  <div className="min-w-0">
                    <div className={`truncate text-sm font-bold ${b.earnedAt ? 'text-yellow-500 text-glow-warning' : ''}`}>{b.name}</div>
                    <div className="truncate text-[10px] text-foreground/70 uppercase tracking-widest font-mono mt-0.5">
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
