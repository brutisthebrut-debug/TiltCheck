import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useLocation } from "wouter"
import { useCreateBet, useGetLeakProfile, getGetLeakProfileQueryKey, getListBetsQueryKey, getGetStatsSummaryQueryKey, getGetRecentActivityQueryKey, getGetBankrollQueryKey, getGetNeedsSettlingQueryKey, getGetUserBadgesQueryKey, getGetStreaksQueryKey } from "@workspace/api-client-react"
import { useUser } from "@/contexts/UserContext"
import { useProStatus } from "@/hooks/use-pro"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { 
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage 
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { formatCurrency } from "@/lib/format"
import { getApiErrorMessage } from "@/lib/api-error"
import { createBetBodyOddsMax } from "@workspace/api-zod"
import { isValidAmericanOdds, payoutFromAmerican } from "@workspace/odds"
import { OddsInput } from "@/components/OddsInput"
import { OddsFormatToggle } from "@/components/OddsFormatToggle"
import { useOddsFormat } from "@/hooks/use-odds-format"
import { ArrowLeft, ChevronDown, AlertTriangle, Lightbulb } from "lucide-react"
import { SPORTSBOOKS, getLastSportsbook, getFavoriteSports, getStakePresets, rememberBetSlipDefaults } from "@/lib/preferences"
import { dayOf } from "@workspace/weeks"

const formSchema = z.object({
  sport: z.string().min(1, "Sport is required"),
  event: z.string().min(1, "Event is required"),
  betType: z.enum(["moneyline", "spread", "total", "prop", "futures"]),
  pick: z.string().min(1, "Pick is required"),
  odds: z.custom<number>(
    (v) =>
      typeof v === "number" &&
      isValidAmericanOdds(v) &&
      Math.abs(v) <= createBetBodyOddsMax,
    { message: "Enter the price your book shows (e.g. -110, 1.91, or 10/11)" }
  ),
  stake: z.coerce.number().positive("Stake must be greater than 0"),
  gameDate: z.string().min(1, "Game date is required"),
  confidenceScore: z.number().min(1).max(10),
  rationale: z.string().optional(),
  sportsbook: z.string().optional(),
  promoNote: z.string().optional(),
})

export default function NewBet() {
  const { activeUser } = useUser()
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const createBet = useCreateBet()
  // A remembered custom book (logged via "Other") is restored as
  // "Other" + prefilled custom name.
  const [lastBook] = useState(() => getLastSportsbook())
  const lastBookIsCustom = lastBook !== null && !SPORTSBOOKS.includes(lastBook)
  const [customSportsbook, setCustomSportsbook] = useState(lastBookIsCustom ? lastBook : "")
  const [showMore, setShowMore] = useState(false)
  const [stakePresets] = useState(() => getStakePresets())
  // Soft nudge, never a block: the first submit without a rationale pauses to
  // ask once; the next click logs the bet regardless.
  const [rationaleNudged, setRationaleNudged] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sport: getFavoriteSports()[0] ?? "",
      event: "",
      betType: "moneyline",
      pick: "",
      odds: -110,
      stake: 100,
      gameDate: dayOf(new Date()),
      confidenceScore: 5,
      rationale: "",
      sportsbook: lastBookIsCustom ? "Other" : (lastBook ?? ""),
      promoNote: "",
    },
  })

  const watchOdds = form.watch("odds")
  const watchStake = form.watch("stake")
  const watchSportsbook = form.watch("sportsbook")
  const watchSport = form.watch("sport")
  const watchConfidence = form.watch("confidenceScore")

  // The bettor's own history, turned into one pointed heads-up before they
  // repeat their most common mistake. Never blocks the bet. Pro-only: free
  // accounts simply get no warning, never an error.
  const { isPro } = useProStatus()
  const { data: leakProfile } = useGetLeakProfile(
    { userId: activeUser?.id },
    { query: { enabled: isPro && !!activeUser?.id, queryKey: getGetLeakProfileQueryKey({ userId: activeUser?.id }), staleTime: 60_000 } }
  )

  const leakWarning = (() => {
    if (!leakProfile) return null
    const stakeNum = Number(watchStake)
    // 0) Tilt spiral: the session-level pattern outranks everything — a
    // cluster of Ls followed by rapid, escalated plays is happening *now*.
    if (leakProfile.tiltSpiral) {
      const t = leakProfile.tiltSpiral
      return {
        key: "tilt-spiral",
        text: `Pump the brakes. ${t.recentLosses} Ls in the last ${t.windowHours} hours, ${t.rapidPlays} quick plays since, staked ${t.stakeRatio}x your usual. This is the tilt playbook — the board will still be here tomorrow.`,
      }
    }
    // 1) Chasing: an oversized stake shortly after taking an L
    if (
      leakProfile.avgStake != null &&
      leakProfile.lastLossAt != null &&
      Number.isFinite(stakeNum) &&
      stakeNum >= leakProfile.avgStake * 1.5
    ) {
      const hoursSinceLoss = (Date.now() - new Date(leakProfile.lastLossAt).getTime()) / 3_600_000
      if (hoursSinceLoss <= 24) {
        const mult = (stakeNum / leakProfile.avgStake).toFixed(1)
        const when = hoursSinceLoss < 1 ? "less than an hour ago" : `${Math.round(hoursSinceLoss)}h ago`
        return {
          key: "chasing",
          text: `Your last L landed ${when} and this stake is ${mult}x your average (${formatCurrency(leakProfile.avgStake)}). There's a word for that: chasing.`,
        }
      }
    }
    // 2) Overconfidence: high confidence hasn't been earning it
    if (leakProfile.overconfidence && watchConfidence >= 7) {
      return {
        key: "overconfidence",
        text: `Your ${watchConfidence}/10 confidence plays are a leak — your 7+ picks hit just ${leakProfile.overconfidence.winRate}% over ${leakProfile.overconfidence.sample} bets.`,
      }
    }
    // 3) Worst sport: this sport keeps taking their money
    if (leakProfile.worstSport && watchSport === leakProfile.worstSport.sport) {
      return {
        key: "worstSport",
        text: `${leakProfile.worstSport.sport} is your most expensive habit: ${formatCurrency(leakProfile.worstSport.netLoss)} over ${leakProfile.worstSport.bets} bets. Just so we're clear.`,
      }
    }
    return null
  })()
  
  const [oddsFormat, setOddsFormatPref] = useOddsFormat()
  const potentialPayout =
    watchStake && isValidAmericanOdds(watchOdds) ? payoutFromAmerican(watchOdds, watchStake) : 0

  function onSubmit(values: z.infer<typeof formSchema>) {
    if (!activeUser) return
    if (!values.rationale?.trim() && !rationaleNudged) {
      setRationaleNudged(true)
      return
    }
    const sportsbook = values.sportsbook === "Other" ? (customSportsbook || "Other") : (values.sportsbook || undefined)
    createBet.mutate({
      data: {
        userId: activeUser.id,
        ...values,
        sportsbook,
        // Whitespace-only rationale is normalized away so the detail page's
        // honest "no rationale" state stays honest.
        rationale: values.rationale?.trim() || undefined,
        promoNote: values.promoNote || undefined,
      }
    }, {
      onSuccess: () => {
        rememberBetSlipDefaults({ sportsbook, stake: values.stake })
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey({ userId: activeUser.id }) })
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey({ limit: 5 }) })
        queryClient.invalidateQueries({ queryKey: getGetBankrollQueryKey({ userId: activeUser.id }) })
        queryClient.invalidateQueries({ queryKey: getGetNeedsSettlingQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetUserBadgesQueryKey(activeUser.id) })
        queryClient.invalidateQueries({ queryKey: getGetStreaksQueryKey({ userId: activeUser.id }) })
        setLocation("/bets")
      }
    })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/bets")} className="rounded-full" aria-label="Back to bets">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Bet</h1>
          <p className="text-muted-foreground mt-1">Log a new straight bet.</p>
        </div>
      </div>

      <Card className="bg-card">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sport"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sport</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select sport" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="NFL">NFL</SelectItem>
                          <SelectItem value="NBA">NBA</SelectItem>
                          <SelectItem value="MLB">MLB</SelectItem>
                          <SelectItem value="NHL">NHL</SelectItem>
                          <SelectItem value="NCAAF">NCAAF</SelectItem>
                          <SelectItem value="NCAAB">NCAAB</SelectItem>
                          <SelectItem value="Soccer">Soccer</SelectItem>
                          <SelectItem value="Tennis">Tennis</SelectItem>
                          <SelectItem value="MMA">MMA</SelectItem>
                          <SelectItem value="Golf">Golf</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="betType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bet Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="moneyline">Moneyline</SelectItem>
                          <SelectItem value="spread">Spread</SelectItem>
                          <SelectItem value="total">Total (O/U)</SelectItem>
                          <SelectItem value="prop">Prop</SelectItem>
                          <SelectItem value="futures">Futures</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="event"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event / Matchup</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Chiefs @ Raiders" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="pick"
                  render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <FormLabel>Your Pick</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Chiefs -3.5" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="odds"
                  render={({ field }) => (
                    <FormItem className="col-span-2 sm:col-span-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <FormLabel>Odds</FormLabel>
                        <OddsFormatToggle value={oddsFormat} onChange={setOddsFormatPref} />
                      </div>
                      <FormControl>
                        <OddsInput
                          value={field.value}
                          onChange={field.onChange}
                          format={oddsFormat}
                          data-testid="input-odds"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="stake"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stake ($)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" placeholder="100" {...field} />
                      </FormControl>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {stakePresets.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => form.setValue("stake", preset, { shouldValidate: true })}
                            data-testid={`button-stake-preset-${preset}`}
                            className={`rounded-full border px-3 py-1.5 font-mono text-xs font-medium transition-colors ${
                              Number(field.value) === preset
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            }`}
                          >
                            ${preset}
                          </button>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="gameDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Game Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-md p-4 flex justify-between items-center">
                <div>
                  <div className="text-sm font-medium">Potential Payout</div>
                  <div className="text-xs text-muted-foreground">Includes {formatCurrency(watchStake || 0)} stake</div>
                </div>
                <div className="text-2xl font-bold font-mono text-primary">
                  {formatCurrency(potentialPayout)}
                </div>
              </div>

              {/* The why — front and center, not buried in the extras. Optional,
                  but skipping it earns a nudge at submit time. */}
              <FormField
                control={form.control}
                name="rationale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Lightbulb className="h-3.5 w-3.5 text-primary" />
                      Why are you making this bet?
                      <span className="text-muted-foreground font-normal">(the part future-you reads)</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="What's the edge? If the answer is 'a feeling', write that down too — it'll be educational later."
                        className="h-20 resize-none"
                        data-testid="input-rationale"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Everything below has a sensible default — tucked away so the
                  fast path is just: pick, odds, stake, log. */}
              <div className="rounded-lg border border-dashed border-border">
                <button
                  type="button"
                  onClick={() => setShowMore(!showMore)}
                  data-testid="button-toggle-more"
                  className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>
                    More details
                    <span className="ml-2 text-xs text-muted-foreground/70">
                      {watchSportsbook ? watchSportsbook : "book"} · confidence {form.watch("confidenceScore")}/10
                      {form.watch("promoNote") ? " · promo" : ""}
                    </span>
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? 'rotate-180' : ''}`} />
                </button>

                {showMore && (
                  <div className="space-y-6 border-t border-dashed px-4 py-4">
                    <FormField
                      control={form.control}
                      name="sportsbook"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sportsbook <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Where did you place this?" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {SPORTSBOOKS.map(sb => (
                                <SelectItem key={sb} value={sb}>{sb}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {watchSportsbook === "Other" && (
                      <Input 
                        placeholder="Book name" 
                        value={customSportsbook} 
                        onChange={e => setCustomSportsbook(e.target.value)} 
                      />
                    )}

                    <FormField
                      control={form.control}
                      name="promoNote"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Promo / Boost Note <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. 20% profit boost applied" {...field} />
                          </FormControl>
                          <FormDescription>Note any promotional boost on this bet. You can record the actual payout when you settle.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="confidenceScore"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex justify-between items-center">
                            <FormLabel>Confidence Score</FormLabel>
                            <span className="font-mono font-bold">{field.value} / 10</span>
                          </div>
                          <FormControl>
                            <Slider
                              min={1}
                              max={10}
                              step={1}
                              value={[field.value]}
                              onValueChange={(vals) => field.onChange(vals[0])}
                              className="py-4"
                            />
                          </FormControl>
                          <FormDescription>How confident are you in this edge?</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t bg-muted/20 px-6 py-4">
              {leakWarning && (
                <div
                  className="w-full flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-500"
                  data-testid={`warning-leak-${leakWarning.key}`}
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{leakWarning.text}</span>
                </div>
              )}
              {createBet.isError && (
                <div className="w-full rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                  {getApiErrorMessage(createBet.error, "Couldn't log this bet. Please check the form and try again.")}
                </div>
              )}
              {rationaleNudged && !form.watch("rationale")?.trim() && (
                <div
                  className="w-full flex items-start gap-2.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm"
                  data-testid="nudge-rationale"
                >
                  <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <span>
                    No why? When this settles you'll be grading a bet you can't remember making.
                    One sentence now saves the "what was I thinking" later — or log it anyway.
                  </span>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={createBet.isPending} data-testid="button-submit-bet">
                {createBet.isPending
                  ? "Logging..."
                  : rationaleNudged && !form.watch("rationale")?.trim()
                    ? "Log It Anyway"
                    : "Log Bet"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  )
}
