import { useLocation, useParams } from "wouter"
import { useGetBet, useSettleBet, getListBetsQueryKey, getGetBetQueryKey, getGetStatsSummaryQueryKey, getGetBankrollQueryKey, getGetRecentActivityQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useUser } from "@/contexts/UserContext"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatOdds, formatDate } from "@/lib/format"
import { ArrowLeft, Target, Calendar, DollarSign, Brain, Check, X, Minus } from "lucide-react"

export default function BetDetail() {
  const { id } = useParams()
  const betId = Number(id)
  const [, setLocation] = useLocation()
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  
  const { data: bet, isLoading } = useGetBet(betId, { 
    query: { enabled: !!betId, queryKey: getGetBetQueryKey(betId) } 
  })
  
  const settleBet = useSettleBet()
  const [postGameReview, setPostGameReview] = useState("")

  if (isLoading) {
    return <div className="p-8 text-center animate-pulse">Loading bet details...</div>
  }

  if (!bet) {
    return <div className="p-8 text-center text-destructive">Bet not found</div>
  }

  const handleSettle = (status: 'won' | 'lost' | 'push' | 'void') => {
    settleBet.mutate({
      id: betId,
      data: {
        status,
        postGameReview: postGameReview || undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBetQueryKey(betId) })
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() })
        if (activeUser) {
          queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey({ userId: activeUser.id }) })
          queryClient.invalidateQueries({ queryKey: getGetBankrollQueryKey({ userId: activeUser.id }) })
        }
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey({ limit: 5 }) })
      }
    })
  }

  const isPending = bet.status === 'pending'
  const canSettle = isPending && activeUser?.id === bet.userId

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/bets")} className="rounded-full">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bet Detail</h1>
          <p className="text-muted-foreground mt-1">Logged by {bet.userName}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 bg-card">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline">{bet.sport}</Badge>
                <Badge variant="outline">{bet.betType}</Badge>
              </div>
              <CardTitle className="text-2xl mt-2">{bet.event}</CardTitle>
            </div>
            <Badge variant={bet.status as any} className="text-base px-3 py-1">
              {bet.status.toUpperCase()}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
              <div className="text-sm text-muted-foreground mb-1">The Pick</div>
              <div className="text-xl font-bold flex justify-between items-center">
                <span>{bet.pick}</span>
                <span className="font-mono text-primary">{formatOdds(bet.odds)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3"/> Stake</div>
                <div className="font-mono font-medium">{formatCurrency(bet.stake)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Potential Payout</div>
                <div className="font-mono font-medium">{formatCurrency(bet.potentialPayout)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3"/> Game Date</div>
                <div className="font-medium">{formatDate(bet.gameDate)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground flex items-center gap-1"><Brain className="h-3 w-3"/> Confidence</div>
                <div className="font-mono font-medium">{bet.confidenceScore} / 10</div>
              </div>
            </div>

            {bet.actualPayout !== null && bet.actualPayout !== undefined && (
              <div className={`p-4 rounded-lg border flex justify-between items-center ${bet.actualPayout > bet.stake ? 'bg-green-500/10 border-green-500/20' : bet.actualPayout < bet.stake ? 'bg-red-500/10 border-red-500/20' : 'bg-muted/50 border-border'}`}>
                <div className="font-medium">Actual Payout</div>
                <div className={`font-mono text-xl font-bold ${bet.actualPayout > bet.stake ? 'text-green-500' : bet.actualPayout < bet.stake ? 'text-red-500' : ''}`}>
                  {formatCurrency(bet.actualPayout)}
                </div>
              </div>
            )}

            {bet.rationale && (
              <div className="space-y-2 pt-2 border-t">
                <div className="text-sm font-semibold">Pre-game Rationale</div>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-background p-3 rounded border">
                  {bet.rationale}
                </p>
              </div>
            )}
            
            {bet.postGameReview && (
              <div className="space-y-2 pt-2 border-t">
                <div className="text-sm font-semibold">Post-game Review</div>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-background p-3 rounded border">
                  {bet.postGameReview}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {canSettle && (
          <Card className="border-primary/20 bg-primary/5 h-fit">
            <CardHeader>
              <CardTitle className="text-lg">Settle Bet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="review">Post-game Review (Optional)</Label>
                <Textarea 
                  id="review" 
                  placeholder="What did you learn? Was the rationale right even if the result was wrong?"
                  value={postGameReview}
                  onChange={(e) => setPostGameReview(e.target.value)}
                  className="bg-background h-24 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button 
                  variant="outline" 
                  className="bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20"
                  onClick={() => handleSettle('won')}
                  disabled={settleBet.isPending}
                >
                  <Check className="mr-2 h-4 w-4" /> Won
                </Button>
                <Button 
                  variant="outline" 
                  className="bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20"
                  onClick={() => handleSettle('lost')}
                  disabled={settleBet.isPending}
                >
                  <X className="mr-2 h-4 w-4" /> Lost
                </Button>
                <Button 
                  variant="outline" 
                  className="col-span-2 bg-muted hover:bg-muted/80"
                  onClick={() => handleSettle('push')}
                  disabled={settleBet.isPending}
                >
                  <Minus className="mr-2 h-4 w-4" /> Push
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
