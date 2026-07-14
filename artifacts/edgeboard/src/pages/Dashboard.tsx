import { useUser } from "@/contexts/UserContext"
import { 
  useGetStatsSummary, 
  useGetRecentActivity,
  useGetBankroll,
  getGetStatsSummaryQueryKey,
  getGetRecentActivityQueryKey,
  getGetBankrollQueryKey
} from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatOdds } from "@/lib/format"
import { Activity, Flame, Snowflake, TrendingUp, TrendingDown, Target, ListTodo, Check } from "lucide-react"

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

  const isLoading = isUserLoading || isStatsLoading || isActivityLoading || isBankrollLoading;

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

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back, {activeUser.displayName}. Here's your edge today.</p>
      </div>

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
              {stats?.roi > 0 ? '+' : ''}{(stats?.roi ?? 0).toFixed(1)}%
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

        <Card className="col-span-1 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Action Center</CardTitle>
            <CardDescription>Pending items that need your attention</CardDescription>
          </CardHeader>
          <CardContent>
            {stats && stats.pending > 0 ? (
              <div className="flex flex-col items-center justify-center py-6 space-y-4">
                <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center">
                  <ListTodo className="h-8 w-8 text-primary" />
                </div>
                <div className="text-center">
                  <h3 className="font-semibold text-lg">{stats.pending} Pending Bets</h3>
                  <p className="text-sm text-muted-foreground">Waiting for results</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 space-y-3 text-center border border-dashed border-primary/30 rounded-md">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <Check className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">All caught up!</p>
                  <p className="text-xs text-muted-foreground mt-1">No pending bets to settle</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
