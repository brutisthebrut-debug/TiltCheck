import { useMemo, useState } from "react"
import { useUser } from "@/contexts/UserContext"
import { useGetLessons, getGetLessonsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { QueryErrorCard } from "@/components/QueryErrorCard"
import { formatCurrency } from "@/lib/format"
import { Link } from "wouter"
import {
  BookOpen,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Quote,
} from "lucide-react"

const MISS_REASON_LABELS: Record<string, string> = {
  bad_read: "Bad read",
  bad_price: "Bad price",
  lineup_injury: "Lineup / injury news",
  emotional: "Emotional bet",
  misunderstood_market: "Misunderstood market",
  normal_variance: "Normal variance",
  na: "N/A",
}

const RESULT_FILTERS = [
  { value: "all", label: "All results" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "push", label: "Push" },
] as const

const QUALITY_FILTERS = [
  { value: "all", label: "Any reasoning" },
  { value: "sound", label: "Sound" },
  { value: "flawed", label: "Flawed" },
  { value: "ungraded", label: "Ungraded" },
] as const

function Chip({ active, onClick, children, testId }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  testId?: string
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

export default function Lessons() {
  const { activeUser } = useUser()
  const [resultFilter, setResultFilter] = useState<string>("all")
  const [qualityFilter, setQualityFilter] = useState<string>("all")
  const [reasonFilter, setReasonFilter] = useState<string>("all")

  const { data, isLoading, isError, refetch, isRefetching } = useGetLessons(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetLessonsQueryKey({ userId: activeUser?.id }) } }
  )

  const filtered = useMemo(() => {
    if (!data) return []
    return data.items.filter((i) => {
      if (resultFilter !== "all" && i.result !== resultFilter) return false
      if (qualityFilter === "sound" && i.reasoningQuality !== "sound") return false
      if (qualityFilter === "flawed" && i.reasoningQuality !== "flawed") return false
      if (qualityFilter === "ungraded" && i.reasoningQuality != null) return false
      if (reasonFilter !== "all" && i.missReason !== reasonFilter) return false
      return true
    })
  }, [data, resultFilter, qualityFilter, reasonFilter])

  // Only offer miss-reason filters that actually appear in the data.
  const availableReasons = useMemo(() => {
    const seen = new Set<string>()
    for (const i of data?.items ?? []) {
      if (i.missReason && i.missReason !== "na") seen.add(i.missReason)
    }
    return [...seen]
  }, [data])

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Lesson Library</h1>
        <QueryErrorCard
          title="Your lessons didn't load."
          message="Connection hiccup — your post-mortems are still on the books."
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          testId="card-lessons-error"
        />
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Lesson Library</h1>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse bg-muted/50 h-28" />
          ))}
        </div>
      </div>
    )
  }

  const { summary } = data

  if (summary.settledCount === 0) {
    return (
      <div className="space-y-8 animate-in fade-in-50 duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lesson Library</h1>
          <p className="text-muted-foreground mt-1">Every post-mortem you've written, in one place.</p>
        </div>
        <Card className="border-dashed border-2 border-muted">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              <BookOpen className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No settled plays yet</h2>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                Once a bet settles and you grade the call, the lesson lands here.
                The library is where you catch yourself repeating the same mistake.
              </p>
            </div>
            <Button asChild data-testid="button-lessons-first-bet">
              <Link href="/bets/new"><Plus className="h-4 w-4 mr-1" />Log First Bet</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const unreviewedCount = summary.settledCount - summary.reviewedCount

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Lesson Library</h1>
        <p className="text-muted-foreground mt-1">Every post-mortem you've written, in one place.</p>
      </div>

      {/* Summary strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-card">
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Reviewed</p>
            <div className="text-2xl font-bold font-mono mt-1" data-testid="text-lessons-reviewed">
              {summary.reviewedCount}<span className="text-muted-foreground text-base font-normal"> of {summary.settledCount}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {unreviewedCount > 0
                ? `${unreviewedCount} settled ${unreviewedCount === 1 ? "play" : "plays"} still ungraded — the book doesn't write itself.`
                : "Every settled play graded. That's the discipline."}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Sound vs. Flawed</p>
            <div className="text-2xl font-bold font-mono mt-1 flex items-baseline gap-2" data-testid="text-lessons-quality-ratio">
              <span className="text-chart-1 text-glow-success">{summary.soundCount}</span>
              <span className="text-muted-foreground text-base font-normal">/</span>
              <span className="text-chart-2 text-glow-destructive">{summary.flawedCount}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.soundCount + summary.flawedCount === 0
                ? "No reasoning grades yet."
                : summary.flawedCount > summary.soundCount
                  ? "More flawed than sound. The market thanks you."
                  : "Process holding up. Keep grading honestly."}
            </p>
          </CardContent>
        </Card>

        <Card className={`bg-card ${summary.mostRepeatedMistake ? "border-chart-2/40" : ""}`}>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Most Repeated Mistake</p>
            {summary.mostRepeatedMistake ? (
              <>
                <div className="text-lg font-bold mt-1 flex items-center gap-2 text-chart-2 text-glow-destructive" data-testid="text-lessons-top-mistake">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {MISS_REASON_LABELS[summary.mostRepeatedMistake.reason] ?? summary.mostRepeatedMistake.reason}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {summary.mostRepeatedMistake.count} losses and counting. You've read this lesson before.
                </p>
              </>
            ) : (
              <>
                <div className="text-lg font-bold mt-1 text-muted-foreground" data-testid="text-lessons-top-mistake">
                  None yet
                </div>
                <p className="text-xs text-muted-foreground mt-1">No repeated mistake pattern — or not enough graded losses to catch one.</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {RESULT_FILTERS.map((f) => (
            <Chip key={f.value} active={resultFilter === f.value} onClick={() => setResultFilter(f.value)} testId={`chip-lessons-result-${f.value}`}>
              {f.label}
            </Chip>
          ))}
          <span className="shrink-0 w-px bg-border self-stretch" aria-hidden />
          {QUALITY_FILTERS.map((f) => (
            <Chip key={f.value} active={qualityFilter === f.value} onClick={() => setQualityFilter(f.value)} testId={`chip-lessons-quality-${f.value}`}>
              {f.label}
            </Chip>
          ))}
        </div>
        {availableReasons.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <Chip active={reasonFilter === "all"} onClick={() => setReasonFilter("all")} testId="chip-lessons-reason-all">
              Any miss reason
            </Chip>
            {availableReasons.map((r) => (
              <Chip key={r} active={reasonFilter === r} onClick={() => setReasonFilter(r)} testId={`chip-lessons-reason-${r}`}>
                {MISS_REASON_LABELS[r] ?? r}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* Feed */}
      {filtered.length === 0 ? (
        <Card className="border-dashed border-2 border-muted">
          <CardContent className="py-12 text-center text-sm text-muted-foreground" data-testid="text-lessons-no-match">
            Nothing matches those filters. Either great news or you haven't graded those plays yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="list-lessons">
          {filtered.map((item) => {
            const href = item.type === "parlay" ? `/parlays/${item.id}` : `/bets/${item.id}`
            return (
              <Card key={`${item.type}-${item.id}`} className="bg-card" data-testid={`card-lesson-${item.type}-${item.id}`}>
                <CardContent className="pt-4 pb-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={href} className="font-medium text-sm hover:text-primary transition-colors block truncate">
                        {item.title}
                      </Link>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {item.sport ?? "Parlay"} · {formatCurrency(item.stake, true)} at {item.odds > 0 ? "+" : ""}{item.odds}
                        {" · "}confidence {item.confidenceScore}/10
                        {item.settledAt ? ` · ${new Date(item.settledAt).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant={item.result === "won" ? "default" : item.result === "lost" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                        {item.result}
                      </Badge>
                      {item.profit != null && (
                        <span className={`text-xs font-mono font-bold ${item.profit > 0 ? "text-chart-1 text-glow-success" : item.profit < 0 ? "text-chart-2 text-glow-destructive" : "text-muted-foreground"}`}>
                          {item.profit > 0 ? "+" : ""}{formatCurrency(item.profit, true)}
                        </span>
                      )}
                    </div>
                  </div>

                  {item.rationale && (
                    <div className="flex gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
                      <Quote className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <p className="text-xs text-foreground/90 italic">{item.rationale}</p>
                    </div>
                  )}

                  {item.reviewed ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {item.reasoningQuality === "sound" && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-chart-1 text-glow-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Sound reasoning
                        </span>
                      )}
                      {item.reasoningQuality === "flawed" && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-chart-2 text-glow-destructive">
                          <XCircle className="h-3.5 w-3.5" /> Flawed reasoning
                        </span>
                      )}
                      {item.missReason && item.missReason !== "na" && (
                        <Badge variant="outline" className="text-[10px] border-chart-2/40 text-chart-2">
                          {MISS_REASON_LABELS[item.missReason] ?? item.missReason}
                        </Badge>
                      )}
                      {item.whatHappened && (
                        <p className="w-full text-xs text-muted-foreground">{item.whatHappened}</p>
                      )}
                    </div>
                  ) : (
                    <Link
                      href={href}
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline underline-offset-4"
                      data-testid={`link-lesson-review-${item.type}-${item.id}`}
                    >
                      No post-mortem yet — grade the call
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
