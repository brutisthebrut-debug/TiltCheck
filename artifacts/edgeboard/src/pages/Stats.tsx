import { useUser } from "@/contexts/UserContext"
import { useGetStatsSummary, useGetStatsBySport, useGetConfidenceAnalysis, getGetStatsSummaryQueryKey, getGetStatsBySportQueryKey, getGetConfidenceAnalysisQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LineChart, Line } from "recharts"

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
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="animate-pulse bg-muted/50 h-80" />
          <Card className="animate-pulse bg-muted/50 h-80" />
        </div>
      </div>
    )
  }

  if (!summary) return null

  // Ensure confidence data is sorted by range (1-3, 4-6, 7-10)
  const sortedConfidenceData = [...confidenceData].sort((a, b) => {
    const aVal = parseInt(a.confidenceRange.split('-')[0])
    const bVal = parseInt(b.confidenceRange.split('-')[0])
    return aVal - bVal
  })

  // Prepare sport data, sorted by total wagered
  const sortedSportData = [...sportStats].sort((a, b) => b.totalWagered - a.totalWagered).slice(0, 7)

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground mt-1">Deep dive into your betting performance.</p>
      </div>

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
            <p className="text-xs text-muted-foreground mt-1">
              Highest single payout
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
            <p className="text-xs text-muted-foreground mt-1">
              Across all straight bets
            </p>
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
            {sortedSportData.length > 0 ? (
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
                No sport data available
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
            {sortedConfidenceData.length > 0 ? (
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
                No confidence data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Sport Breakdown</CardTitle>
          <CardDescription>Detailed statistics per sport</CardDescription>
        </CardHeader>
        <CardContent>
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
                {sortedSportData.length > 0 ? (
                  sortedSportData.map((sport) => (
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
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No sport data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
