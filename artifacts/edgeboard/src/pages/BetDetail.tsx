import { useLocation, useParams } from "wouter"
import { useGetBet, useSettleBet, useUpdateBet, getListBetsQueryKey, getGetBetQueryKey, getGetStatsSummaryQueryKey, getGetBankrollQueryKey, getGetRecentActivityQueryKey, getGetNeedsSettlingQueryKey, getGetUserBadgesQueryKey, getGetStreaksQueryKey } from "@workspace/api-client-react"
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
import { ArrowLeft, Calendar, DollarSign, Brain, Check, X, Minus, Ban, Lock, AlertTriangle } from "lucide-react"
import { SettleMoment, type SettleMomentData } from "@/components/SettleMoment"
import { QueryErrorCard } from "@/components/QueryErrorCard"

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

export default function BetDetail() {
  const { id } = useParams()
  const [oddsFormat] = useOddsFormat()
  const betId = Number(id)
  const [, setLocation] = useLocation()
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  
  const { data: bet, isLoading, isError, refetch, isRefetching } = useGetBet(betId, { 
    query: { enabled: !!betId, queryKey: getGetBetQueryKey(betId) } 
  })
  
  const settleBet = useSettleBet()
  const updateBet = useUpdateBet()

  // Odds re-entry (dead-zone repair) state
  const [fixOpen, setFixOpen] = useState(false)
  const [newOdds, setNewOdds] = useState('')
  const [fixError, setFixError] = useState<string | null>(null)

  const handleFixOdds = () => {
    const parsed = Number(newOdds)
    if (!Number.isInteger(parsed) || isDeadZoneOdds(parsed)) {
      setFixError('Enter valid American odds: -100 or lower, or +100 or higher.')
      return
    }
    setFixError(null)
    updateBet.mutate({ id: betId, data: { odds: parsed } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBetQueryKey(betId) })
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() })
        if (activeUser) {
          queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey({ userId: activeUser.id }) })
        }
        setFixOpen(false)
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
    if (!bet || !pendingStatus) return

    settleBet.mutate({
      id: betId,
      data: {
        status: pendingStatus,
        reasoningQuality: reasoningQuality || undefined,
        whatHappened: whatHappened || undefined,
        missReason: (missReason as any) || undefined,
        actualPayoutOverride: actualPayoutOverride ? Number(actualPayoutOverride) : undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBetQueryKey(betId) })
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() })
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
          const payout = actualPayoutOverride ? Number(actualPayoutOverride) : bet.potentialPayout
          setMoment({ kind: 'won', profit: Math.max(0, payout - bet.stake) })
        } else if (pendingStatus === 'lost') {
          setMoment({ kind: 'lost', lost: bet.stake })
        }
        resetModal()
      }
    })
  }

  if (isError) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/bets")} className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Bet Detail</h1>
        </div>
        <QueryErrorCard
          title="This bet didn't load."
          message="Not a bad beat — just a connection problem. The play is still on the record."
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          testId="card-bet-detail-error"
        />
      </div>
    )
  }

  if (isLoading) {
    return <div className="p-8 text-center animate-pulse">Loading bet details...</div>
  }

  if (!bet) {
    return <div className="p-8 text-center text-destructive">Bet not found</div>
  }

  const isPending = bet.status === 'pending'
  const canSettle = isPending && activeUser?.id === bet.userId
  const isSettled = !isPending
  const hasDeadZoneOdds = isDeadZoneOdds(bet.odds)
  const isOwner = activeUser?.id === bet.userId

  const statusLabel: Record<SettleStatus, string> = { won: 'Won ✓', lost: 'Lost ✗', push: 'Push', void: 'Void' }
  const statusColor: Record<SettleStatus, string> = {
    won: 'bg-green-500/10 text-green-500 border-green-500/20',
    lost: 'bg-red-500/10 text-red-500 border-red-500/20',
    push: 'bg-muted text-foreground border-border',
    void: 'bg-blue-500/10 text-blue-400 border-blue-400/20',
  }

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

      {hasDeadZoneOdds && (
        <Alert className="border-amber-500/40 bg-amber-500/10 [&>svg]:text-amber-500">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-amber-500">These odds aren't a real price — please re-enter them</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            <p>
              American odds are never between -99 and +99, so <span className="font-mono text-amber-500">{formatOdds(bet.odds)}</span> can't
              be right. This bet is left out of your stats until the odds are corrected — once fixed, it counts again automatically.
            </p>
            {isOwner ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-amber-500/40 text-amber-500 hover:bg-amber-500/20"
                onClick={() => { setFixError(null); setNewOdds(''); setFixOpen(true) }}
              >
                Re-enter odds
              </Button>
            ) : (
              <p className="mt-2 text-xs">Only {bet.userName} knows the real price, so only they can correct it.</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 bg-card">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge variant="outline">{bet.sport}</Badge>
                <Badge variant="outline">{bet.betType}</Badge>
                {bet.sportsbook && <Badge variant="outline" className="text-xs">{bet.sportsbook}</Badge>}
              </div>
              <CardTitle className="text-2xl mt-2">{bet.event}</CardTitle>
            </div>
            <Badge variant={bet.status as any} className="text-base px-3 py-1 shrink-0">
              {bet.status.toUpperCase()}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
              <div className="text-sm text-muted-foreground mb-1">The Pick</div>
              <div className="text-xl font-bold flex justify-between items-center">
                <span>{bet.pick}</span>
                <span className="font-mono text-primary">{formatOddsAs(bet.odds, oddsFormat)}</span>
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
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Brain className="h-3 w-3"/> Confidence
                  {isSettled && <Lock className="h-3 w-3 text-muted-foreground/50 ml-1" />}
                </div>
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

            {bet.promoNote && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-2 rounded bg-muted/30 border border-dashed border-muted-foreground/20">
                <span className="shrink-0">🎁</span>
                <span>{bet.promoNote}</span>
              </div>
            )}

            {bet.rationale && (
              <div className="space-y-2 pt-2 border-t">
                <div className="text-sm font-semibold flex items-center gap-2">
                  Pre-game Rationale
                  {isSettled && <Lock className="h-3 w-3 text-muted-foreground/50" />}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-background p-3 rounded border">
                  {bet.rationale}
                </p>
              </div>
            )}
            
            {/* Post-game review (settled) */}
            {isSettled && (bet.reasoningQuality || bet.whatHappened || bet.missReason) && (
              <div className="space-y-3 pt-2 border-t">
                <div className="text-sm font-semibold">Post-result Review</div>
                {bet.reasoningQuality && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Reasoning:</span>
                    <Badge variant={bet.reasoningQuality === 'sound' ? 'default' : 'destructive'} className="capitalize">
                      {bet.reasoningQuality}
                    </Badge>
                  </div>
                )}
                {bet.missReason && bet.missReason !== 'na' && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Miss reason:</span>
                    <span className="font-medium">{MISS_REASONS.find(r => r.value === bet.missReason)?.label ?? bet.missReason}</span>
                  </div>
                )}
                {bet.whatHappened && (
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-background p-3 rounded border border-primary/20">
                    {bet.whatHappened}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grade panel */}
        {canSettle && (
          <Card className="border-primary/20 bg-primary/5 h-fit">
            <CardHeader>
              <CardTitle className="text-lg">Grade Result</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Select the outcome to open the review form.</p>
              <Button 
                variant="outline" 
                className="w-full bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20"
                onClick={() => handleGradeClick('won')}
              >
                <Check className="mr-2 h-4 w-4" /> Won
              </Button>
              <Button 
                variant="outline" 
                className="w-full bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20"
                onClick={() => handleGradeClick('lost')}
              >
                <X className="mr-2 h-4 w-4" /> Lost
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => handleGradeClick('push')}
              >
                <Minus className="mr-2 h-4 w-4" /> Push
              </Button>
              <Button 
                variant="outline" 
                className="w-full bg-blue-500/10 text-blue-400 border-blue-400/20 hover:bg-blue-500/20"
                onClick={() => handleGradeClick('void')}
              >
                <Ban className="mr-2 h-4 w-4" /> Void
              </Button>
              <p className="text-[10px] text-muted-foreground">Void returns your stake and removes this bet from record counts.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Odds re-entry modal (dead-zone repair) */}
      <Dialog open={fixOpen} onOpenChange={(open) => { if (!open) setFixOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Re-enter the real odds</DialogTitle>
            <DialogDescription>
              {bet.pick} · currently recorded as <span className="font-mono text-amber-500">{formatOdds(bet.odds)}</span>, which isn't a
              real American price. Enter the odds you actually got — the potential payout recalculates automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="fix-odds">Correct American odds</Label>
            <Input
              id="fix-odds"
              type="number"
              step="1"
              placeholder="e.g. -110 or +150"
              value={newOdds}
              onChange={e => setNewOdds(e.target.value)}
              className="bg-background font-mono"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Must be -100 or lower, or +100 or higher.</p>
            {fixError && <p className="text-xs text-destructive">{fixError}</p>}
          </div>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button variant="outline" onClick={() => setFixOpen(false)} className="sm:w-auto w-full">Cancel</Button>
            <Button onClick={handleFixOdds} disabled={updateBet.isPending || newOdds.trim() === ''} className="sm:w-auto w-full">
              {updateBet.isPending ? 'Saving...' : 'Save corrected odds'}
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
              {' '}— {bet.pick} · {formatOddsAs(bet.odds, oddsFormat)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Actual payout override (won + any promo) */}
            {pendingStatus === 'won' && (
              <div className="space-y-2">
                <Label>
                  Actual Payout Override 
                  <span className="text-muted-foreground font-normal"> (optional — use for promo boosts)</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Input 
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={`Default: ${formatCurrency(bet.potentialPayout)}`}
                    value={actualPayoutOverride}
                    onChange={e => setActualPayoutOverride(e.target.value)}
                    className="bg-background"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Leave blank to use calculated payout.</p>
              </div>
            )}

            {/* Reasoning quality */}
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
                "Sound" = right process even if wrong result. "Flawed" = bad decision-making regardless of outcome.
              </p>
            </div>

            {/* What happened */}
            <div className="space-y-2">
              <Label>What happened? <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea 
                placeholder="Briefly describe what played out. What did you learn?"
                value={whatHappened}
                onChange={e => setWhatHappened(e.target.value)}
                className="bg-background h-20 resize-none"
              />
            </div>

            {/* Miss / result reason */}
            <div className="space-y-2">
              <Label>
                {pendingStatus === 'won' ? 'Win category' : 'Miss reason'} 
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
              disabled={settleBet.isPending}
              className={`sm:w-auto w-full ${pendingStatus === 'won' ? 'bg-green-600 hover:bg-green-700' : pendingStatus === 'lost' ? 'bg-red-600 hover:bg-red-700' : ''}`}
            >
              {settleBet.isPending ? 'Saving...' : `Confirm — ${pendingStatus ? statusLabel[pendingStatus] : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettleMoment moment={moment} onDone={() => setMoment(null)} />
    </div>
  )
}
