import { useLocation, useParams } from "wouter"
import { useGetParlay, useSettleParlay, getListParlaysQueryKey, getGetParlayQueryKey, getGetStatsSummaryQueryKey, getGetBankrollQueryKey, getGetRecentActivityQueryKey } from "@workspace/api-client-react"
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
import type { LegResult } from "@workspace/api-client-react"

export default function ParlayDetail() {
  const { id } = useParams()
  const parlayId = Number(id)
  const [, setLocation] = useLocation()
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  
  const { data: parlay, isLoading } = useGetParlay(parlayId, { 
    query: { enabled: !!parlayId, queryKey: getGetParlayQueryKey(parlayId) } 
  })
  
  const settleParlay = useSettleParlay()
  const [postGameReview, setPostGameReview] = useState("")
  const [legResults, setLegResults] = useState<Record<number, 'won' | 'lost' | 'push' | 'void'>>({})

  if (isLoading) {
    return <div className="p-8 text-center animate-pulse">Loading parlay details...</div>
  }

  if (!parlay) {
    return <div className="p-8 text-center text-destructive">Parlay not found</div>
  }

  const handleSettle = (status: 'won' | 'lost' | 'push' | 'void') => {
    // Format leg results for the API
    const formattedLegResults: LegResult[] = Object.entries(legResults).map(([legId, status]) => ({
      legId: Number(legId),
      status
    }))

    settleParlay.mutate({
      id: parlayId,
      data: {
        status,
        postGameReview: postGameReview || undefined,
        legResults: formattedLegResults.length > 0 ? formattedLegResults : undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetParlayQueryKey(parlayId) })
        queryClient.invalidateQueries({ queryKey: getListParlaysQueryKey() })
        if (activeUser) {
          queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey({ userId: activeUser.id }) })
          queryClient.invalidateQueries({ queryKey: getGetBankrollQueryKey({ userId: activeUser.id }) })
        }
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey({ limit: 5 }) })
      }
    })
  }

  const handleLegResult = (legId: number, status: 'won' | 'lost' | 'push' | 'void') => {
    setLegResults(prev => ({ ...prev, [legId]: status }))
  }

  const isPending = parlay.status === 'pending'
  const canSettle = isPending && activeUser?.id === parlay.userId

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/parlays")} className="rounded-full">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Parlay Detail</h1>
          <p className="text-muted-foreground mt-1">Logged by {parlay.userName}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card className="bg-card">
            <CardHeader className="flex flex-row items-start justify-between pb-4 border-b">
              <div>
                <CardTitle className="text-2xl">{parlay.name}</CardTitle>
                <div className="text-sm text-muted-foreground mt-1">
                  {parlay.legs.length} Legs • Logged {formatDate(parlay.createdAt)}
                </div>
              </div>
              <Badge variant={parlay.status as any} className="text-base px-3 py-1">
                {parlay.status.toUpperCase()}
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {parlay.legs.map((leg, index) => (
                  <div key={leg.id} className={`p-4 ${leg.status === 'won' ? 'bg-green-500/5' : leg.status === 'lost' ? 'bg-red-500/5' : ''}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-12">Leg {index + 1}</span>
                        <Badge variant="outline" className="text-xs">{leg.sport}</Badge>
                        <Badge variant="outline" className="text-xs">{leg.betType}</Badge>
                      </div>
                      <Badge variant={leg.status as any} className="text-xs">{leg.status.toUpperCase()}</Badge>
                    </div>
                    
                    <div className="ml-14">
                      <div className="font-medium text-muted-foreground text-sm">{leg.event}</div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-lg font-bold">{leg.pick}</span>
                        <span className="font-mono text-primary font-medium">{formatOdds(leg.odds)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">{formatDate(leg.gameDate)}</div>
                      
                      {canSettle && (
                        <div className="mt-3 flex gap-2">
                          <Button 
                            size="sm" 
                            variant={legResults[leg.id] === 'won' ? 'default' : 'outline'} 
                            className={legResults[leg.id] === 'won' ? 'bg-green-500 hover:bg-green-600' : ''}
                            onClick={() => handleLegResult(leg.id, 'won')}
                          >
                            W
                          </Button>
                          <Button 
                            size="sm" 
                            variant={legResults[leg.id] === 'lost' ? 'default' : 'outline'}
                            className={legResults[leg.id] === 'lost' ? 'bg-red-500 hover:bg-red-600' : ''}
                            onClick={() => handleLegResult(leg.id, 'lost')}
                          >
                            L
                          </Button>
                          <Button 
                            size="sm" 
                            variant={legResults[leg.id] === 'push' ? 'secondary' : 'outline'}
                            onClick={() => handleLegResult(leg.id, 'push')}
                          >
                            P
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          
          {(parlay.rationale || parlay.postGameReview) && (
            <Card className="bg-card">
              <CardContent className="p-6 space-y-6">
                {parlay.rationale && (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">Pre-game Rationale</div>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-background p-4 rounded-md border">
                      {parlay.rationale}
                    </p>
                  </div>
                )}
                
                {parlay.postGameReview && (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Brain className="h-4 w-4" /> Post-game Review
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-background p-4 rounded-md border border-primary/20">
                      {parlay.postGameReview}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="bg-card">
            <CardHeader>
              <CardTitle className="text-lg">Parlay Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Combined Odds</span>
                <span className="font-mono font-bold text-lg text-primary">{formatOdds(parlay.odds)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Stake</span>
                <span className="font-mono font-medium text-lg">{formatCurrency(parlay.stake)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Pot. Payout</span>
                <span className="font-mono font-medium text-lg">{formatCurrency(parlay.potentialPayout)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Confidence</span>
                <span className="font-mono font-medium text-lg">{parlay.confidenceScore} / 10</span>
              </div>

              {parlay.actualPayout !== null && parlay.actualPayout !== undefined && (
                <div className={`mt-4 p-4 rounded-lg border flex justify-between items-center ${parlay.actualPayout > parlay.stake ? 'bg-green-500/10 border-green-500/20' : parlay.actualPayout < parlay.stake ? 'bg-red-500/10 border-red-500/20' : 'bg-muted/50 border-border'}`}>
                  <div className="font-medium text-sm">Actual Payout</div>
                  <div className={`font-mono text-xl font-bold ${parlay.actualPayout > parlay.stake ? 'text-green-500' : parlay.actualPayout < parlay.stake ? 'text-red-500' : ''}`}>
                    {formatCurrency(parlay.actualPayout)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {canSettle && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-lg">Settle Parlay</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="review">Post-game Review (Optional)</Label>
                  <Textarea 
                    id="review" 
                    placeholder="Review the overall parlay strategy"
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
                    disabled={settleParlay.isPending}
                  >
                    <Check className="mr-2 h-4 w-4" /> Won
                  </Button>
                  <Button 
                    variant="outline" 
                    className="bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20"
                    onClick={() => handleSettle('lost')}
                    disabled={settleParlay.isPending}
                  >
                    <X className="mr-2 h-4 w-4" /> Lost
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
