import { useLocation, useParams } from "wouter"
import { useGetParlay, useSettleParlay, useUpdateParlayLeg, getListParlaysQueryKey, getGetParlayQueryKey, getGetStatsSummaryQueryKey, getGetBankrollQueryKey, getGetRecentActivityQueryKey, getGetNeedsSettlingQueryKey, getGetUserBadgesQueryKey, getGetStreaksQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { useUser } from "@/contexts/UserContext"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatCurrency, formatOdds, formatDate } from "@/lib/format"
import { formatOddsAs } from "@workspace/odds"
import { useOddsFormat } from "@/hooks/use-odds-format"
import { isDeadZoneOdds } from "@/lib/odds"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ArrowLeft, Brain, Check, X, Minus, Ban, Lock, AlertTriangle } from "lucide-react"
import { SettleMoment, type SettleMomentData } from "@/components/SettleMoment"
import type { LegResult } from "@workspace/api-client-react"

type SettleStatus = 'won' | 'lost' | 'push' | 'void'

const MISS_REASONS = [
  { value: 'bad_read', label: 'Bad read — misread the matchup' },
  { value: 'bad_price', label: 'Bad price — right read, wrong number' },
  { value: 'lineup_injury', label: 'Lineup/injury — info unavailable at bet time' },
  { value: 'emotional', label: 'Emotional / impulse bet' },
  { value: 'misunderstood_market', label: 'Misunderstood market or line' },
  { value: 'normal_variance', label: 'Normal variance — right process, wrong result' },
  { value: 'na', label: 'N/A' },
]

export default function ParlayDetail() {
  const { id } = useParams()
  const [oddsFormat] = useOddsFormat()
  const parlayId = Number(id)
  const [, setLocation] = useLocation()
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  
  const { data: parlay, isLoading } = useGetParlay(parlayId, { 
    query: { enabled: !!parlayId, queryKey: getGetParlayQueryKey(parlayId) } 
  })
  
  const settleParlay = useSettleParlay()
  const updateParlayLeg = useUpdateParlayLeg()
  const [legResults, setLegResults] = useState<Record<number, 'won' | 'lost' | 'push' | 'void'>>({})

  // Leg odds re-entry (dead-zone repair) state
  const [fixLegId, setFixLegId] = useState<number | null>(null)
  const [newOdds, setNewOdds] = useState('')
  const [fixError, setFixError] = useState<string | null>(null)

  const openFixDialog = (legId: number) => {
    setFixError(null)
    setNewOdds('')
    setFixLegId(legId)
  }

  const handleFixLegOdds = () => {
    if (fixLegId == null) return
    const parsed = Number(newOdds)
    if (!Number.isInteger(parsed) || isDeadZoneOdds(parsed)) {
      setFixError('Enter valid American odds: -100 or lower, or +100 or higher.')
      return
    }
    setFixError(null)
    updateParlayLeg.mutate({ id: parlayId, legId: fixLegId, data: { odds: parsed } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetParlayQueryKey(parlayId) })
        queryClient.invalidateQueries({ queryKey: getListParlaysQueryKey() })
        if (activeUser) {
          queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey({ userId: activeUser.id }) })
        }
        setFixLegId(null)
        setNewOdds('')
      },
      onError: (err: any) => {
        setFixError(err?.message ?? 'Could not update the odds. Please try again.')
      },
    })
  }

  // Modal state
  const [pendingStatus, setPendingStatus] = useState<SettleStatus | null>(null)
  const [reasoningQuality, setReasoningQuality] = useState<'sound' | 'flawed' | ''>('')
  const [whatHappened, setWhatHappened] = useState('')
  const [missReason, setMissReason] = useState('')
  const [actualPayoutOverride, setActualPayoutOverride] = useState('')
  const [moment, setMoment] = useState<SettleMomentData | null>(null)

  const resetModal = () => {
    setPendingStatus(null)
    setReasoningQuality('')
    setWhatHappened('')
    setMissReason('')
    setActualPayoutOverride('')
  }

  const handleGradeClick = (status: SettleStatus) => {
    setPendingStatus(status)
  }

  const handleSubmitReview = () => {
    if (!parlay || !pendingStatus) return
    const formattedLegResults: LegResult[] = Object.entries(legResults).map(([legId, status]) => ({
      legId: Number(legId),
      status
    }))

    settleParlay.mutate({
      id: parlayId,
      data: {
        status: pendingStatus,
        reasoningQuality: reasoningQuality || undefined,
        whatHappened: whatHappened || undefined,
        missReason: (missReason as any) || undefined,
        actualPayoutOverride: actualPayoutOverride ? Number(actualPayoutOverride) : undefined,
        legResults: formattedLegResults.length > 0 ? formattedLegResults : undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetParlayQueryKey(parlayId) })
        queryClient.invalidateQueries({ queryKey: getListParlaysQueryKey() })
        if (activeUser) {
          queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey({ userId: activeUser.id }) })
          queryClient.invalidateQueries({ queryKey: getGetBankrollQueryKey({ userId: activeUser.id }) })
          queryClient.invalidateQueries({ queryKey: getGetUserBadgesQueryKey(activeUser.id) })
          queryClient.invalidateQueries({ queryKey: getGetStreaksQueryKey({ userId: activeUser.id }) })
        }
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey({ limit: 5 }) })
        queryClient.invalidateQueries({ queryKey: getGetNeedsSettlingQueryKey() })
        // The result is saved — this is just the moment. Skippable, never blocking.
        if (pendingStatus === 'won') {
          const payout = actualPayoutOverride ? Number(actualPayoutOverride) : parlay.potentialPayout
          setMoment({ kind: 'won', profit: Math.max(0, payout - parlay.stake) })
        } else if (pendingStatus === 'lost') {
          setMoment({ kind: 'lost', lost: parlay.stake })
        }
        resetModal()
      }
    })
  }

  const handleLegResult = (legId: number, status: 'won' | 'lost' | 'push' | 'void') => {
    setLegResults(prev => ({ ...prev, [legId]: status }))
  }

  if (isLoading) {
    return <div className="p-8 text-center animate-pulse">Loading parlay details...</div>
  }

  if (!parlay) {
    return <div className="p-8 text-center text-destructive">Parlay not found</div>
  }

  const isPending = parlay.status === 'pending'
  const canSettle = isPending && activeUser?.id === parlay.userId
  const isSettled = !isPending
  const deadZoneLegs = parlay.legs.filter(leg => isDeadZoneOdds(leg.odds))
  const hasDeadZoneCombined = isDeadZoneOdds(parlay.odds)
  const hasDeadZoneIssue = deadZoneLegs.length > 0 || hasDeadZoneCombined
  const isOwner = activeUser?.id === parlay.userId

  const statusLabel: Record<SettleStatus, string> = { won: 'Won ✓', lost: 'Lost ✗', push: 'Push', void: 'Void' }

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

      {hasDeadZoneIssue && (
        <Alert className="border-amber-500/40 bg-amber-500/10 [&>svg]:text-amber-500">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-amber-500">
            {deadZoneLegs.length > 0
              ? `${deadZoneLegs.length === 1 ? 'One leg carries' : `${deadZoneLegs.length} legs carry`} odds that aren't a real price`
              : "The combined odds aren't a real price"}
          </AlertTitle>
          <AlertDescription className="text-muted-foreground">
            <p>
              American odds are never between -99 and +99.{' '}
              {deadZoneLegs.length > 0
                ? 'The flagged legs below need their odds re-entered — until then, the combined odds and payout can\'t be trusted, and this parlay is left out of your stats.'
                : 'The stored combined odds are impossible, so this parlay is left out of your stats until they are corrected.'}
              {' '}Once corrected, it counts in your stats again automatically.
            </p>
            <p className="mt-2 text-xs">
              {isOwner
                ? isPending
                  ? deadZoneLegs.length > 0
                    ? 'Only you know the real prices. Click "Re-enter odds" on a flagged leg below to correct it — the combined odds and payout recalculate automatically.'
                    : 'Only you know the real prices. The legs look valid, so ask an admin to recompute the combined odds from them.'
                  : 'This parlay is already settled, so its recorded payout is part of your bankroll history and the odds can no longer be edited.'
                : `Only ${parlay.userName} knows the real prices, so only they can correct this parlay.`}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card className="bg-card">
            <CardHeader className="flex flex-row items-start justify-between pb-4 border-b">
              <div>
                <CardTitle className="text-2xl">{parlay.name}</CardTitle>
                <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span>{parlay.legs.length} Legs · Logged {formatDate(parlay.createdAt)}</span>
                  {parlay.sportsbook && <Badge variant="outline" className="text-xs">{parlay.sportsbook}</Badge>}
                </div>
              </div>
              <Badge variant={parlay.status as any} className="text-base px-3 py-1 shrink-0">
                {parlay.status.toUpperCase()}
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {parlay.legs.map((leg, index) => (
                  <div key={leg.id} className={`p-4 ${leg.status === 'won' ? 'bg-green-500/5' : leg.status === 'lost' ? 'bg-red-500/5' : ''}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Leg {index + 1}</span>
                        <Badge variant="outline" className="text-xs">{leg.sport}</Badge>
                        <Badge variant="outline" className="text-xs">{leg.betType}</Badge>
                        {isDeadZoneOdds(leg.odds) && (
                          isOwner && isPending ? (
                            <button
                              type="button"
                              onClick={() => openFixDialog(leg.id)}
                              title="These odds aren't a real American price — click to re-enter them."
                              className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-500 transition-colors hover:bg-amber-500/25 hover:border-amber-500/70"
                            >
                              <AlertTriangle className="h-3 w-3" /> Re-enter odds
                            </button>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-500 gap-1"
                              title="These odds aren't a real American price — they need to be re-entered."
                            >
                              <AlertTriangle className="h-3 w-3" /> Re-enter odds
                            </Badge>
                          )
                        )}
                      </div>
                      <Badge variant={leg.status as any} className="text-xs shrink-0">{leg.status.toUpperCase()}</Badge>
                    </div>
                    
                    <div className="ml-0 sm:ml-14">
                      <div className="font-medium text-muted-foreground text-sm">{leg.event}</div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-lg font-bold">{leg.pick}</span>
                        <span className={`font-mono font-medium ${isDeadZoneOdds(leg.odds) ? 'text-amber-500' : 'text-primary'}`}>{isDeadZoneOdds(leg.odds) ? formatOdds(leg.odds) : formatOddsAs(leg.odds, oddsFormat)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">{formatDate(leg.gameDate)}</div>
                      
                      {canSettle && (
                        <div className="mt-3 flex gap-1.5">
                          {(['won', 'lost', 'push', 'void'] as const).map(s => (
                            <button
                              key={s}
                              onClick={() => handleLegResult(leg.id, s)}
                              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                                legResults[leg.id] === s
                                  ? s === 'won' ? 'bg-green-500 text-white border-green-600'
                                  : s === 'lost' ? 'bg-red-500 text-white border-red-600'
                                  : s === 'void' ? 'bg-blue-500 text-white border-blue-600'
                                  : 'bg-secondary text-secondary-foreground border-secondary'
                                : 'bg-card text-muted-foreground border-border hover:border-primary/30'
                              }`}
                            >
                              {s === 'won' ? 'W' : s === 'lost' ? 'L' : s === 'push' ? 'P' : 'V'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          
          {(parlay.rationale || parlay.promoNote || isSettled) && (
            <Card className="bg-card">
              <CardContent className="p-6 space-y-6">
                {parlay.promoNote && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-2 rounded bg-muted/30 border border-dashed border-muted-foreground/20">
                    <span className="shrink-0">🎁</span>
                    <span>{parlay.promoNote}</span>
                  </div>
                )}

                {parlay.rationale && (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      Pre-game Rationale
                      {isSettled && <Lock className="h-3 w-3 text-muted-foreground/50" />}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-background p-4 rounded-md border">
                      {parlay.rationale}
                    </p>
                  </div>
                )}
                
                {isSettled && (parlay.reasoningQuality || parlay.whatHappened || parlay.missReason) && (
                  <div className="space-y-3 pt-2 border-t">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Brain className="h-4 w-4" /> Post-result Review
                    </div>
                    {parlay.reasoningQuality && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Reasoning:</span>
                        <Badge variant={parlay.reasoningQuality === 'sound' ? 'default' : 'destructive'} className="capitalize">
                          {parlay.reasoningQuality}
                        </Badge>
                      </div>
                    )}
                    {parlay.missReason && parlay.missReason !== 'na' && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Miss reason:</span>
                        <span className="font-medium">{MISS_REASONS.find(r => r.value === parlay.missReason)?.label ?? parlay.missReason}</span>
                      </div>
                    )}
                    {parlay.whatHappened && (
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-background p-4 rounded-md border border-primary/20">
                        {parlay.whatHappened}
                      </p>
                    )}
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
                <span className={`font-mono font-bold text-lg flex items-center gap-1.5 ${hasDeadZoneCombined || deadZoneLegs.length > 0 ? 'text-amber-500' : 'text-primary'}`}>
                  {(hasDeadZoneCombined || deadZoneLegs.length > 0) && <AlertTriangle className="h-4 w-4" />}
                  {hasDeadZoneCombined || deadZoneLegs.length > 0 ? formatOdds(parlay.odds) : formatOddsAs(parlay.odds, oddsFormat)}
                </span>
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
                <span className="font-mono font-medium text-lg flex items-center gap-1">
                  {parlay.confidenceScore} / 10
                  {isSettled && <Lock className="h-3 w-3 text-muted-foreground/50" />}
                </span>
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
                <CardTitle className="text-lg">Grade Parlay</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Mark leg results above, then grade the overall parlay.</p>
                <Button 
                  variant="outline" 
                  className="w-full bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20"
                  onClick={() => handleGradeClick('won')}
                  disabled={settleParlay.isPending}
                >
                  <Check className="mr-2 h-4 w-4" /> Won
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20"
                  onClick={() => handleGradeClick('lost')}
                  disabled={settleParlay.isPending}
                >
                  <X className="mr-2 h-4 w-4" /> Lost
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => handleGradeClick('push')}
                  disabled={settleParlay.isPending}
                >
                  <Minus className="mr-2 h-4 w-4" /> Push
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full bg-blue-500/10 text-blue-400 border-blue-400/20 hover:bg-blue-500/20"
                  onClick={() => handleGradeClick('void')}
                  disabled={settleParlay.isPending}
                >
                  <Ban className="mr-2 h-4 w-4" /> Void
                </Button>
                <p className="text-[10px] text-muted-foreground">Void returns your stake and removes this parlay from record counts.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Leg odds re-entry (dead-zone repair) modal */}
      <Dialog open={fixLegId !== null} onOpenChange={(open) => { if (!open) setFixLegId(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Re-enter the real odds</DialogTitle>
            <DialogDescription>
              {(() => {
                const leg = parlay.legs.find(l => l.id === fixLegId)
                return leg
                  ? <>Leg: <span className="font-medium text-foreground">{leg.pick}</span> — {leg.event}. The stored odds ({formatOdds(leg.odds)}) aren't a real American price. Enter the correct odds; the parlay's combined odds and potential payout will recalculate from all legs.</>
                  : 'Enter the correct American odds for this leg.'
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="fix-leg-odds">Correct American odds</Label>
            <Input
              id="fix-leg-odds"
              type="number"
              step="1"
              placeholder="e.g. -110 or +150"
              value={newOdds}
              onChange={e => setNewOdds(e.target.value)}
              className="bg-background"
              autoFocus
            />
            {fixError && <p className="text-xs text-destructive">{fixError}</p>}
            <p className="text-xs text-muted-foreground">American odds are -100 or lower, or +100 or higher.</p>
          </div>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setFixLegId(null)} className="sm:w-auto w-full">Cancel</Button>
            <Button onClick={handleFixLegOdds} disabled={updateParlayLeg.isPending || newOdds.trim() === ''} className="sm:w-auto w-full">
              {updateParlayLeg.isPending ? 'Saving...' : 'Save corrected odds'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-result review modal */}
      <Dialog open={pendingStatus !== null} onOpenChange={(open) => { if (!open) resetModal() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Post-result Review</DialogTitle>
            <DialogDescription>
              Grading as: <span className={`font-semibold ${pendingStatus === 'won' ? 'text-green-500' : pendingStatus === 'lost' ? 'text-red-500' : pendingStatus === 'void' ? 'text-blue-400' : ''}`}>
                {pendingStatus ? statusLabel[pendingStatus] : ''}
              </span>
              {' '}— {parlay.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {pendingStatus === 'won' && (
              <div className="space-y-2">
                <Label>
                  Actual Payout Override 
                  <span className="text-muted-foreground font-normal"> (optional — use for promo boosts)</span>
                </Label>
                <Input 
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={`Default: ${formatCurrency(parlay.potentialPayout)}`}
                  value={actualPayoutOverride}
                  onChange={e => setActualPayoutOverride(e.target.value)}
                  className="bg-background"
                />
                <p className="text-xs text-muted-foreground">Leave blank to use calculated payout.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Was your reasoning sound?</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setReasoningQuality('sound')}
                  className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium transition-colors ${
                    reasoningQuality === 'sound' 
                      ? 'bg-green-500/10 text-green-500 border-green-500/30' 
                      : 'bg-card border-border hover:border-primary/30'
                  }`}
                >
                  ✓ Sound
                </button>
                <button
                  type="button"
                  onClick={() => setReasoningQuality('flawed')}
                  className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium transition-colors ${
                    reasoningQuality === 'flawed' 
                      ? 'bg-red-500/10 text-red-500 border-red-500/30' 
                      : 'bg-card border-border hover:border-primary/30'
                  }`}
                >
                  ✗ Flawed
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                "Sound" = right process even if wrong result. "Flawed" = bad decision-making.
              </p>
            </div>

            <div className="space-y-2">
              <Label>What happened? <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea 
                placeholder="Briefly describe what played out. What did you learn?"
                value={whatHappened}
                onChange={e => setWhatHappened(e.target.value)}
                className="bg-background h-20 resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label>
                Miss reason 
                <span className="text-muted-foreground font-normal"> (optional)</span>
              </Label>
              <Select value={missReason} onValueChange={setMissReason}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {MISS_REASONS.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button variant="outline" onClick={resetModal} className="sm:w-auto w-full">Cancel</Button>
            <Button 
              onClick={handleSubmitReview} 
              disabled={settleParlay.isPending}
              className={`sm:w-auto w-full ${pendingStatus === 'won' ? 'bg-green-600 hover:bg-green-700' : pendingStatus === 'lost' ? 'bg-red-600 hover:bg-red-700' : ''}`}
            >
              {settleParlay.isPending ? 'Saving...' : `Confirm — ${pendingStatus ? statusLabel[pendingStatus] : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettleMoment moment={moment} onDone={() => setMoment(null)} />
    </div>
  )
}
