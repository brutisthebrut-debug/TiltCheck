import { useUser } from "@/contexts/UserContext"
import { useCompareWorkspaceMembers, getCompareWorkspaceMembersQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import { Trophy, TrendingUp, TrendingDown, Swords } from "lucide-react"

export default function Workspace() {
  const { activeUser } = useUser()

  const { data: members = [], isLoading } = useCompareWorkspaceMembers(
    { query: { queryKey: getCompareWorkspaceMembersQueryKey() } }
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Workspace</h1>
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="animate-pulse bg-muted/50 h-96" />
          <Card className="animate-pulse bg-muted/50 h-96" />
        </div>
      </div>
    )
  }

  // Ensure we have 2 members to compare, pad with empty data if needed
  const displayMembers = [...members]
  while (displayMembers.length < 2) {
    displayMembers.push({
      userId: -1,
      userName: "Waiting for player",
      avatarColor: "#ccc",
      totalBets: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      roi: 0,
      totalProfit: 0,
      currentBankroll: 0,
      avgConfidence: 0,
      hotSport: null
    })
  }

  const p1 = displayMembers[0]
  const p2 = displayMembers[1]

  const getWinner = (val1: number, val2: number, lowerIsBetter = false) => {
    if (val1 === val2) return null
    if (lowerIsBetter) return val1 < val2 ? p1.userId : p2.userId
    return val1 > val2 ? p1.userId : p2.userId
  }

  const winners = {
    profit: getWinner(p1.totalProfit, p2.totalProfit),
    roi: getWinner(p1.roi, p2.roi),
    winRate: getWinner(p1.winRate, p2.winRate),
    bankroll: getWinner(p1.currentBankroll, p2.currentBankroll),
  }

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Workspace Head-to-Head</h1>
        <p className="text-muted-foreground mt-1">Compare performance across the squad.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
        {/* Player 1 Card */}
        <Card className={`relative overflow-hidden ${p1.userId === activeUser?.id ? 'border-primary ring-1 ring-primary' : ''}`}>
          {p1.userId === activeUser?.id && (
            <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] uppercase font-bold px-2 py-1 rounded-bl-lg">
              You
            </div>
          )}
          <CardHeader className="text-center pb-2">
            <div 
              className="w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-xl font-bold border-4 border-background shadow-md"
              style={{ backgroundColor: p1.avatarColor }}
            >
              {p1.userName.substring(0, 2).toUpperCase()}
            </div>
            <CardTitle className="text-2xl">{p1.userName}</CardTitle>
            <CardDescription>{p1.totalBets} Total Plays</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-1 text-center p-3 bg-muted/30 rounded-lg">
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Net Profit</div>
              <div className={`text-3xl font-bold font-mono ${winners.profit === p1.userId ? 'text-green-500' : ''}`}>
                {p1.totalProfit > 0 ? '+' : ''}{formatCurrency(p1.totalProfit, true)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-muted/20 rounded-lg text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Win Rate</div>
                <div className={`text-xl font-bold font-mono ${winners.winRate === p1.userId ? 'text-primary' : ''}`}>
                  {p1.winRate.toFixed(1)}%
                </div>
              </div>
              <div className="p-3 bg-muted/20 rounded-lg text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">ROI</div>
                <div className={`text-xl font-bold font-mono ${winners.roi === p1.userId ? 'text-primary' : ''}`}>
                  {p1.roi > 0 ? '+' : ''}{p1.roi.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="pt-4 border-t space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Bankroll</span>
                <span className={`font-mono font-medium ${winners.bankroll === p1.userId ? 'text-primary font-bold' : ''}`}>
                  {formatCurrency(p1.currentBankroll, true)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Record</span>
                <span className="font-mono font-medium">{p1.wins}-{p1.losses}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Hot Sport</span>
                <span className="font-medium">{p1.hotSport || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Avg Confidence</span>
                <span className="font-mono font-medium">{p1.avgConfidence.toFixed(1)} / 10</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* VS Divider */}
        <div className="flex flex-col items-center justify-center py-4 lg:py-0 hidden lg:flex">
          <div className="h-16 w-px bg-border mb-4"></div>
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center border-4 border-background z-10 shadow-sm text-muted-foreground">
            <Swords className="h-6 w-6" />
          </div>
          <div className="h-16 w-px bg-border mt-4"></div>
        </div>
        
        {/* Mobile VS */}
        <div className="flex items-center justify-center lg:hidden -my-2 relative z-10">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center border-4 border-background shadow-sm text-muted-foreground">
            <span className="font-bold text-xs italic">VS</span>
          </div>
        </div>

        {/* Player 2 Card */}
        <Card className={`relative overflow-hidden ${p2.userId === activeUser?.id ? 'border-primary ring-1 ring-primary' : ''}`}>
          {p2.userId === activeUser?.id && (
            <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] uppercase font-bold px-2 py-1 rounded-bl-lg">
              You
            </div>
          )}
          <CardHeader className="text-center pb-2">
            <div 
              className="w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-xl font-bold border-4 border-background shadow-md"
              style={{ backgroundColor: p2.avatarColor }}
            >
              {p2.userName.substring(0, 2).toUpperCase()}
            </div>
            <CardTitle className="text-2xl">{p2.userName}</CardTitle>
            <CardDescription>{p2.totalBets} Total Plays</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-1 text-center p-3 bg-muted/30 rounded-lg">
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Net Profit</div>
              <div className={`text-3xl font-bold font-mono ${winners.profit === p2.userId ? 'text-green-500' : ''}`}>
                {p2.totalProfit > 0 ? '+' : ''}{formatCurrency(p2.totalProfit, true)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-muted/20 rounded-lg text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Win Rate</div>
                <div className={`text-xl font-bold font-mono ${winners.winRate === p2.userId ? 'text-primary' : ''}`}>
                  {p2.winRate.toFixed(1)}%
                </div>
              </div>
              <div className="p-3 bg-muted/20 rounded-lg text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">ROI</div>
                <div className={`text-xl font-bold font-mono ${winners.roi === p2.userId ? 'text-primary' : ''}`}>
                  {p2.roi > 0 ? '+' : ''}{p2.roi.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="pt-4 border-t space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Bankroll</span>
                <span className={`font-mono font-medium ${winners.bankroll === p2.userId ? 'text-primary font-bold' : ''}`}>
                  {formatCurrency(p2.currentBankroll, true)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Record</span>
                <span className="font-mono font-medium">{p2.wins}-{p2.losses}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Hot Sport</span>
                <span className="font-medium">{p2.hotSport || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Avg Confidence</span>
                <span className="font-mono font-medium">{p2.avgConfidence.toFixed(1)} / 10</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
