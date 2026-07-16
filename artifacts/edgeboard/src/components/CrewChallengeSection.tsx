/**
 * CrewChallengeSection — crew challenge creation, active banner, and history.
 *
 * Owners can start a 7-day challenge from a metric-picker modal. The active
 * banner shows live standings with days remaining. Past challenges show the
 * winner. Free crews get all challenge features; Pro unlocks historical detail.
 */
import { useState } from "react"
import {
  useListCrewChallenges,
  getListCrewChallengesQueryKey,
  useGetActiveChallengeStandings,
  getGetActiveChallengeStandingsQueryKey,
  useCreateCrewChallenge,
  useDeleteCrewChallenge,
  type ChallengeStanding,
  type CrewChallengeWithResult,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Trophy, Swords, Crown, X } from "lucide-react"
import { toast } from "@/hooks/use-toast"

type Metric = "roi" | "win_rate" | "calibration" | "postmortem_rate"

const METRIC_OPTIONS: { value: Metric; label: string; description: string; defaultTitle: string }[] = [
  { value: "roi", label: "Best ROI", description: "Who squeezes the most out of their bankroll", defaultTitle: "Best ROI" },
  { value: "win_rate", label: "Hot Streak", description: "Highest win rate on settled plays", defaultTitle: "Hot Streak" },
  { value: "calibration", label: "Sharpest Read", description: "Best calibration — confidence matched reality", defaultTitle: "Sharpest Read" },
  { value: "postmortem_rate", label: "Discipline Run", description: "Who reviewed the most of their plays", defaultTitle: "Discipline Run" },
]

function metricLabel(metric: string): string {
  return METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? metric
}

function formatValue(metric: string, value: number | null | undefined): string {
  if (value == null) return "—"
  switch (metric) {
    case "roi": return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`
    case "win_rate": return `${value.toFixed(1)}%`
    case "calibration": return value.toFixed(1)
    case "postmortem_rate": return `${value.toFixed(0)}%`
    default: return String(value)
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActiveChallengeBanner({ crewId, isOwner }: { crewId: number; isOwner: boolean }) {
  const queryClient = useQueryClient()
  const cancel = useDeleteCrewChallenge({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCrewChallengesQueryKey(crewId) })
        queryClient.invalidateQueries({ queryKey: getGetActiveChallengeStandingsQueryKey(crewId) })
        toast({ title: "Challenge cancelled", description: "The challenge has been scrapped — no winner recorded." })
      },
    },
  })

  const { data, isLoading } = useGetActiveChallengeStandings(crewId, {
    query: { queryKey: getGetActiveChallengeStandingsQueryKey(crewId), staleTime: 30_000, refetchOnWindowFocus: true },
  })

  if (isLoading) return <div className="animate-pulse h-40 rounded-xl bg-muted/40" />
  if (!data) return null

  const { challenge, standings, daysRemaining } = data
  const isClosed = daysRemaining < 0 || challenge.closedAt != null

  return (
    <Card className="border-primary/50 bg-primary/5" data-testid="card-active-challenge">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">{challenge.label}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {metricLabel(challenge.metric)} · {challenge.startDate} → {challenge.endDate}
                {isClosed ? (
                  <Badge variant="outline" className="ml-2 text-[9px] px-1.5 py-0 border-muted-foreground/50">Closed</Badge>
                ) : (
                  <Badge variant="outline" className="ml-2 text-[9px] px-1.5 py-0 border-primary/50 text-primary">
                    {daysRemaining === 0 ? "Last day" : `${daysRemaining}d left`}
                  </Badge>
                )}
              </CardDescription>
            </div>
          </div>
          {isOwner && !isClosed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ id: crewId, challengeId: challenge.id })}
              aria-label="Cancel challenge"
              data-testid="button-cancel-challenge"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {(standings as ChallengeStanding[]).map((s) => (
          <div
            key={s.userId}
            className={`flex items-center gap-3 rounded-md px-3 py-2 ${s.rank === 1 ? "bg-primary/15 border border-primary/30" : "bg-muted/20"}`}
            data-testid={`row-standing-${s.userId}`}
          >
            <span className="w-5 text-center font-mono text-xs font-bold text-muted-foreground shrink-0">
              {s.rank === 1 ? <Crown className="h-4 w-4 text-yellow-500 inline" /> : s.rank}
            </span>
            <span
              className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ backgroundColor: s.avatarColor }}
            >
              {s.userName.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 text-sm font-medium truncate">{s.userName}</span>
            <span className={`font-mono text-sm font-bold shrink-0 ${s.rank === 1 && s.value != null ? "text-primary" : ""}`}>
              {formatValue(challenge.metric, s.value)}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0 w-12 text-right">
              {s.settledCount} settled
            </span>
          </div>
        ))}
        {standings.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-md">
            No settled plays in the challenge window yet.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChallengeHistory({ challenges }: { challenges: CrewChallengeWithResult[] }) {
  const closed = challenges.filter((c) => !c.isActive && c.closedAt != null)
  if (closed.length === 0) return null
  return (
    <div className="space-y-2" data-testid="section-challenge-history">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Past Challenges</h3>
      {closed.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5"
          data-testid={`row-past-challenge-${c.id}`}
        >
          <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{c.label}</div>
            <div className="text-xs text-muted-foreground">{metricLabel(c.metric)} · {c.startDate} → {c.endDate}</div>
          </div>
          <div className="text-right shrink-0">
            {c.winnerName ? (
              <div>
                <div className="text-sm font-bold">{c.winnerName}</div>
                <div className="text-xs text-muted-foreground font-mono">{formatValue(c.metric, c.winnerValue)}</div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No winner</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateChallengeModal({
  crewId,
  open,
  onClose,
}: {
  crewId: number
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [metric, setMetric] = useState<Metric>("roi")
  const [label, setLabel] = useState("")

  const create = useCreateCrewChallenge({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCrewChallengesQueryKey(crewId) })
        queryClient.invalidateQueries({ queryKey: getGetActiveChallengeStandingsQueryKey(crewId) })
        toast({ title: "Challenge started", description: "The crew is on the clock. May the sharpest bettor win." })
        onClose()
        setLabel("")
        setMetric("roi")
      },
      onError: (err: { response?: { data?: { message?: string } } }) => {
        toast({
          title: "Couldn't start challenge",
          description: err?.response?.data?.message ?? "Try again in a moment.",
          variant: "destructive",
        })
      },
    },
  })

  const selectedOption = METRIC_OPTIONS.find((m) => m.value === metric)!

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    create.mutate({
      id: crewId,
      data: {
        metric,
        label: label.trim() || selectedOption.defaultTitle,
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm" data-testid="dialog-create-challenge">
        <DialogHeader>
          <DialogTitle>Start a crew challenge</DialogTitle>
          <DialogDescription>
            7-day competition. One metric, one winner. Everyone sees the standings live.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Metric picker */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">What are you competing on?</Label>
            <div className="grid grid-cols-2 gap-2">
              {METRIC_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setMetric(opt.value)
                    if (!label) setLabel(opt.defaultTitle)
                  }}
                  data-testid={`button-metric-${opt.value}`}
                  className={`rounded-md border px-3 py-2.5 text-left text-xs transition-all ${
                    metric === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-card hover:border-primary/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="font-semibold">{opt.label}</div>
                  <div className="mt-0.5 text-[11px] opacity-75 leading-tight">{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom label */}
          <div className="space-y-1.5">
            <Label htmlFor="challenge-label" className="text-sm font-semibold">Challenge name</Label>
            <Input
              id="challenge-label"
              value={label}
              placeholder={selectedOption.defaultTitle}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={40}
              data-testid="input-challenge-label"
            />
            <p className="text-xs text-muted-foreground">Leave blank to use the default. Shown in banners and history.</p>
          </div>

          {create.isError && (
            <p className="text-sm text-destructive">
              {(create.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Couldn't start the challenge. Try again."}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" disabled={create.isPending} data-testid="button-submit-challenge">
              {create.isPending ? "Starting…" : "Start challenge"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface CrewChallengeSectionProps {
  crewId: number
  isOwner: boolean
}

export function CrewChallengeSection({ crewId, isOwner }: CrewChallengeSectionProps) {
  const [showCreate, setShowCreate] = useState(false)

  const { data: challenges = [], isLoading } = useListCrewChallenges(crewId, {
    query: { queryKey: getListCrewChallengesQueryKey(crewId), staleTime: 30_000 },
  })

  const activeChallenge = challenges.find((c) => c.isActive)
  const hasActive = !!activeChallenge

  return (
    <div className="space-y-4" data-testid="section-crew-challenges">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Crew Challenges</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {hasActive
              ? "Live competition — standings update as plays settle."
              : "No active challenge. Start one to give the crew something to play for."}
          </p>
        </div>
        {isOwner && !hasActive && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCreate(true)}
            data-testid="button-start-challenge"
            className="shrink-0 border-primary/40 text-primary hover:bg-primary/5 hover:border-primary/60"
          >
            <Swords className="h-3.5 w-3.5 mr-1.5" />
            Start challenge
          </Button>
        )}
      </div>

      {isLoading && <div className="animate-pulse h-40 rounded-xl bg-muted/40" />}

      {hasActive && <ActiveChallengeBanner crewId={crewId} isOwner={isOwner} />}

      {!isLoading && <ChallengeHistory challenges={challenges} />}

      {!isLoading && !hasActive && !isOwner && challenges.filter((c) => !c.isActive).length === 0 && (
        <Card className="border-dashed border-2 border-muted">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <Swords className="h-8 w-8 text-muted-foreground" />
            <div>
              <div className="text-sm font-semibold">No challenges yet</div>
              <div className="text-xs text-muted-foreground mt-1">The crew owner can start a 7-day competition from here.</div>
            </div>
          </CardContent>
        </Card>
      )}

      <CreateChallengeModal crewId={crewId} open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  )
}
