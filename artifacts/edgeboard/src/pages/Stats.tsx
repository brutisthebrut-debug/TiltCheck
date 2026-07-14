import { useUser } from "@/contexts/UserContext"
import { useGetStatsSummary, useGetStatsBySport, useGetConfidenceAnalysis, useGetStatsInsights, getGetStatsSummaryQueryKey, getGetStatsBySportQueryKey, getGetConfidenceAnalysisQueryKey, getGetStatsInsightsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/format"
import { Link } from "wouter"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LineChart, Line } from "recharts"
import { BarChart2, Plus, Lock, Lightbulb, CheckCircle2, XCircle, ArrowRight } from "lucide-react"

const MISS_REASON_LABELS: Record<string, string> = {
  bad_read: "Bad read",
  bad_price: "Bad price",
  lineup_injury: "Lineup / injury news",
  emotional: "Emotional bet",
  misunderstood_market: "Misunderstood market",
  normal_variance: "Normal variance",
  na: "N/A",
}

export default function Stats() {
  const { activeUser } = useUser()

  const { data: summary, isLoading: isSummaryLoading } = useGetStatsSummary(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetStatsSummaryQueryKey({ userId: activeUser?.id }) } }
  )

  const { data: sportStats = [], isLoading: isSportLoading } = useGetStatsBySport(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetStatsBySportQueryKey({ userId: activeUser?.id }) } }
  )

  const { data: confidenceData = [], isLoading: isConfidenceLoading } = useGetConfidenceAnalysis(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetConfidenceAnalysisQueryKey({ userId: activeUser?.id }) } }
  )

  const { data: insights } = useGetStatsInsights(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetStatsInsightsQueryKey({ userId: activeUser?.id }) } }
  )

  const isLoading = isSummaryLoading || isSportLoading || isConfidenceLoading

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

  if (totalBets === 0) {
    return (
      <div className="space-y-8 animate-in fade-in-50 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">Deep dive into your betting performance.</p>
        </div>
        <Card className="border-dashed border-2 border-muted">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              <BarChart2 className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No data yet</h2>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                Log and grade at least {INSIGHTS_THRESHOLD} bets to unlock sport breakdowns, confidence calibration, and ROI insights.
              </p>
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground mt-1">Deep dive into your betting performance.</p>
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
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Parlays</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {summary.parlayRecord.wins}-{summary.parlayRecord.losses}{summary.parlayRecord.pushes > 0 ? `-${summary.parlayRecord.pushes}` : ''}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Hit Rate: {((summary.parlayRecord.wins / Math.max(1, summary.parlayRecord.wins + summary.parlayRecord.losses)) * 100).toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Best Bet P/L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-green-500">
              +{formatCurrency(summary.bestBetProfit)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Highest single payout</p>
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
            <p className="text-xs text-muted-foreground mt-1">Across all straight bets</p>
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
              <div className="h-full flex items-center justify-center text-muted-foreground border border-dashed rounded-md">
                No sport data yet
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
              <div className="h-full flex items-center justify-center text-muted-foreground border border-dashed rounded-md">
                No confidence data yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Post-result insights feed */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Lessons</h2>
        </div>
        {!insights || insights.reviewedCount < 3 ? (
          <Card className="border-dashed border-2 border-muted">
            <CardContent className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Lightbulb className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-semibold">Not enough reviews yet</h3>
                <p className="text-muted-foreground text-sm mt-1 max-w-md">
                  Grade at least 3 bets with review details (reasoning quality, miss reason, or notes) to unlock
                  patterns from your post-game reviews.
                  {insights ? ` ${insights.reviewedCount} of 3 reviewed so far.` : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
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
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-medium">Sound reasoning</span>
                      </div>
                      <div className="text-2xl font-bold font-mono">{insights.soundReasoning.winRate.toFixed(1)}%</div>
                      <p className="text-xs text-muted-foreground mt-1">{insights.soundReasoning.wins} wins on {insights.soundReasoning.total} graded {insights.soundReasoning.total === 1 ? "bet" : "bets"}</p>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-sm font-medium">Flawed reasoning</span>
                      </div>
                      <div className="text-2xl font-bold font-mono">{insights.flawedReasoning.winRate.toFixed(1)}%</div>
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
              <p className="text-sm">No graded bets yet.</p>
              <p className="text-xs mt-1">Grade a bet to see sport-level breakdown.</p>
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
                      <td className={`px-4 py-3 text-right font-mono font-bold ${sport.profit > 0 ? 'text-green-500' : sport.profit < 0 ? 'text-red-500' : ''}`}>
                        {sport.profit > 0 ? '+' : ''}{formatCurrency(sport.profit, true)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${sport.roi > 0 ? 'text-green-500' : sport.roi < 0 ? 'text-red-500' : ''}`}>
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
