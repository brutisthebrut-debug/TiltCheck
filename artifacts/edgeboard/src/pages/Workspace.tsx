import { useUser } from "@/contexts/UserContext"
import { useCompareWorkspaceMembers, getCompareWorkspaceMembersQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import { Trophy, TrendingUp, TrendingDown, Swords, Users, Link as LinkIcon } from "lucide-react"

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

  // Single-user or no data for second user
  if (members.length < 2 || members.every(m => m.totalBets === 0) || 
      (members.length >= 1 && members.slice(1).every(m => m.totalBets === 0))) {
    const solo = members[0]
    return (
      <div className="space-y-8 animate-in fade-in-50 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workspace Head-to-Head</h1>
          <p className="text-muted-foreground mt-1">Compare performance across the squad.</p>
        </div>

        {/* Solo player card */}
        {solo && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <Card className={`relative overflow-hidden ${solo.userId === activeUser?.id ? 'border-primary ring-1 ring-primary' : ''}`}>
              {solo.userId === activeUser?.id && (
                <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] uppercase font-bold px-2 py-1 rounded-bl-lg">
                  You
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <div 
                  className="w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-xl font-bold border-4 border-background shadow-md"
                  style={{ backgroundColor: solo.avatarColor }}
                >
                  {solo.userName.substring(0, 2).toUpperCase()}
                </div>
                <CardTitle className="text-2xl">{solo.userName}</CardTitle>
                <CardDescription>{solo.totalBets} Total Plays</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="space-y-1 text-center p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Net Profit</div>
                  <div className={`text-3xl font-bold font-mono ${solo.totalProfit > 0 ? 'text-green-500' : solo.totalProfit < 0 ? 'text-red-500' : ''}`}>
                    {solo.totalProfit > 0 ? '+' : ''}{formatCurrency(solo.totalProfit, true)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 bg-muted/20 rounded-lg text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Win Rate</div>
                    <div className="text-xl font-bold font-mono">{solo.winRate.toFixed(1)}%</div>
                  </div>
                  <div className="p-3 bg-muted/20 rounded-lg text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">ROI</div>
                    <div className={`text-xl font-bold font-mono ${solo.roi > 0 ? 'text-green-500' : solo.roi < 0 ? 'text-red-500' : ''}`}>
                      {solo.roi > 0 ? '+' : ''}{solo.roi.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="pt-4 border-t space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Record</span>
                    <span className="font-mono font-medium">{solo.wins}-{solo.losses}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Hot Sport</span>
                    <span className="font-medium">{solo.hotSport || 'N/A'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Waiting for second user */}
            <Card className="lg:col-span-2 border-dashed border-2 border-muted bg-muted/10">
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="max-w-sm">
                  <h2 className="text-lg font-semibold">Waiting for your co-bettor</h2>
                  <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
                    Workspace shows a side-by-side stats comparison once your co-bettor logs their first bet. 
                    Share the app link and have them pick a username to get started.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground px-4 py-2 rounded-full border border-dashed border-muted-foreground/30 bg-background/50">
                  <LinkIcon className="h-3 w-3" />
                  <span>Share the link → they pick a username → comparison unlocks</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {!solo && (
          <Card className="border-dashed border-2 border-muted">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <Users className="h-10 w-10 text-muted-foreground" />
              <div>
                <h2 className="text-lg font-semibold">No players yet</h2>
                <p className="text-muted-foreground text-sm mt-1">Log some bets first, then come back to compare.</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  const p1 = members[0]
  const p2 = members[1]

  const getWinner = (val1: number, val2: number) => {
    if (val1 === val2) return null
    return val1 > val2 ? p1.userId : p2.userId
  }

  const winners = {
    profit: getWinner(p1.totalProfit, p2.totalProfit),
    roi: getWinner(p1.roi, p2.roi),
    winRate: getWinner(p1.winRate, p2.winRate),
    bankroll: getWinner(p1.currentBankroll, p2.currentBankroll),
  }

  function MemberCard({ member, isYou }: { member: typeof members[0]; isYou: boolean }) {
    return (
      <Card className={`relative overflow-hidden ${isYou ? 'border-primary ring-1 ring-primary' : ''}`}>
        {isYou && (
          <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] uppercase font-bold px-2 py-1 rounded-bl-lg">
            You
          </div>
        )}
        <CardHeader className="text-center pb-2">
          <div 
            className="w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-xl font-bold border-4 border-background shadow-md"
            style={{ backgroundColor: member.avatarColor }}
          >
            {member.userName.substring(0, 2).toUpperCase()}
          </div>
          <CardTitle className="text-2xl">{member.userName}</CardTitle>
          <CardDescription>{member.totalBets} Total Plays</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="space-y-1 text-center p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Net Profit</div>
            <div className={`text-3xl font-bold font-mono ${winners.profit === member.userId ? 'text-green-500' : ''}`}>
              {member.totalProfit > 0 ? '+' : ''}{formatCurrency(member.totalProfit, true)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 bg-muted/20 rounded-lg text-center">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Win Rate</div>
              <div className={`text-xl font-bold font-mono ${winners.winRate === member.userId ? 'text-primary' : ''}`}>
                {member.winRate.toFixed(1)}%
              </div>
            </div>
            <div className="p-3 bg-muted/20 rounded-lg text-center">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">ROI</div>
              <div className={`text-xl font-bold font-mono ${winners.roi === member.userId ? 'text-primary' : ''}`}>
                {member.roi > 0 ? '+' : ''}{member.roi.toFixed(1)}%
              </div>
            </div>
          </div>
          <div className="pt-4 border-t space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Bankroll</span>
              <span className={`font-mono font-medium ${winners.bankroll === member.userId ? 'text-primary font-bold' : ''}`}>
                {formatCurrency(member.currentBankroll, true)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Record</span>
              <span className="font-mono font-medium">{member.wins}-{member.losses}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Hot Sport</span>
              <span className="font-medium">{member.hotSport || 'N/A'}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Avg Confidence</span>
              <span className="font-mono font-medium">{member.avgConfidence.toFixed(1)} / 10</span>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Workspace Head-to-Head</h1>
        <p className="text-muted-foreground mt-1">Compare performance across the squad.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
        <MemberCard member={p1} isYou={p1.userId === activeUser?.id} />

        <div className="flex flex-col items-center justify-center py-4 lg:py-0 hidden lg:flex">
          <div className="h-16 w-px bg-border mb-4"></div>
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center border-4 border-background z-10 shadow-sm text-muted-foreground">
            <Swords className="h-6 w-6" />
          </div>
          <div className="h-16 w-px bg-border mt-4"></div>
        </div>
        
        <div className="flex items-center justify-center lg:hidden -my-2 relative z-10">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center border-4 border-background shadow-sm text-muted-foreground">
            <span className="font-bold text-xs italic">VS</span>
          </div>
        </div>

        <MemberCard member={p2} isYou={p2.userId === activeUser?.id} />
      </div>
    </div>
  )
}
