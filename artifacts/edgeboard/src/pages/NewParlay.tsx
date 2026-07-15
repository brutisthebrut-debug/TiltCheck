import { useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useLocation } from "wouter"
import { useCreateParlay, useGetLeakProfile, getGetLeakProfileQueryKey, getListParlaysQueryKey, getGetStatsSummaryQueryKey, getGetRecentActivityQueryKey, getGetBankrollQueryKey, getGetNeedsSettlingQueryKey, getGetUserBadgesQueryKey, getGetStreaksQueryKey } from "@workspace/api-client-react"
import { useUser } from "@/contexts/UserContext"
import { useProStatus } from "@/hooks/use-pro"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { 
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage 
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { formatCurrency } from "@/lib/format"
import { getApiErrorMessage } from "@/lib/api-error"
import { createParlayBodyLegsItemOddsMax } from "@workspace/api-zod"
import {
  combineDecimalExact,
  combineDecimalBookStyle,
  decimalToAmerican,
  formatAmerican,
  isValidAmericanOdds,
} from "@workspace/odds"
import { OddsInput } from "@/components/OddsInput"
import { OddsFormatToggle } from "@/components/OddsFormatToggle"
import { useOddsFormat } from "@/hooks/use-odds-format"
import { ArrowLeft, Plus, Trash2, ChevronDown, AlertTriangle, Lightbulb } from "lucide-react"
import { SPORTSBOOKS, getLastSportsbook, getFavoriteSports, getStakePresets, rememberBetSlipDefaults } from "@/lib/preferences"
import { dayOf } from "@workspace/weeks"

const legSchema = z.object({
  sport: z.string().min(1, "Sport is required"),
  event: z.string().min(1, "Event is required"),
  betType: z.enum(["moneyline", "spread", "total", "prop"]),
  pick: z.string().min(1, "Pick is required"),
  odds: z.custom<number>(
    (v) =>
      typeof v === "number" &&
      isValidAmericanOdds(v) &&
      Math.abs(v) <= createParlayBodyLegsItemOddsMax,
    { message: "Enter the price your book shows (e.g. -110, 1.91, or 10/11)" }
  ),
  gameDate: z.string().min(1, "Game date is required"),
})

const formSchema = z.object({
  name: z.string().min(1, "Parlay name is required"),
  stake: z.coerce.number().positive("Stake must be greater than 0"),
  confidenceScore: z.number().min(1).max(10),
  rationale: z.string().optional(),
  sportsbook: z.string().optional(),
  promoNote: z.string().optional(),
  legs: z.array(legSchema).min(2, "At least 2 legs are required"),
})

export default function NewParlay() {
  const { activeUser } = useUser()
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const createParlay = useCreateParlay()
  // A remembered custom book (logged via "Other") is restored as
  // "Other" + prefilled custom name.
  const [lastBook] = useState(() => getLastSportsbook())
  const lastBookIsCustom = lastBook !== null && !SPORTSBOOKS.includes(lastBook)
  const [customSportsbook, setCustomSportsbook] = useState(lastBookIsCustom ? lastBook : "")
  const [showMore, setShowMore] = useState(false)
  const [stakePresets] = useState(() => getStakePresets())
  // Soft nudge, never a block: the first submit without a rationale pauses to
  // ask once; the next click logs the parlay regardless.
  const [rationaleNudged, setRationaleNudged] = useState(false)

  const defaultLeg = {
    sport: getFavoriteSports()[0] ?? "NFL",
    event: "",
    betType: "moneyline" as const,
    pick: "",
    odds: -110,
    gameDate: dayOf(new Date()),
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      stake: 50,
      confidenceScore: 3,
      rationale: "",
      sportsbook: lastBookIsCustom ? "Other" : (lastBook ?? ""),
      promoNote: "",
      legs: [defaultLeg, defaultLeg],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "legs",
  })

  const watchLegs = form.watch("legs")
  const watchStake = form.watch("stake")
  const watchSportsbook = form.watch("sportsbook")
  const [oddsFormat, setOddsFormatPref] = useOddsFormat()

  // Tilt check — a parlay slip mid-spiral is the classic "get it all back
  // in one ticket" move, so the session-level warning shows here too.
  // Pro-only: free accounts simply get no warning, never an error.
  const { isPro } = useProStatus()
  const { data: leakProfile } = useGetLeakProfile(
    { userId: activeUser?.id },
    { query: { enabled: isPro && !!activeUser?.id, queryKey: getGetLeakProfileQueryKey({ userId: activeUser?.id }), staleTime: 60_000 } }
  )
  const tiltSpiral = leakProfile?.tiltSpiral ?? null

  // Only price the slip once every leg carries a real American price.
  const legOdds = watchLegs.map((leg) => leg.odds)
  const allLegsPriced = legOdds.length > 0 && legOdds.every((o) => isValidAmericanOdds(o))

  // Exact math — identical to what the server stores. No double rounding:
  // the payout comes from the exact decimal product, and the American price
  // is rounded once, only for display.
  const combinedDecimal = allLegsPriced ? combineDecimalExact(legOdds) : 0
  const combinedOdds = allLegsPriced ? decimalToAmerican(combinedDecimal) : 0
  const potentialPayout = allLegsPriced && watchStake ? combinedDecimal * watchStake : 0

  // What a book like bet365 shows for the same slip: it multiplies the
  // 2-decimal displayed prices, so its total can differ by a little.
  const bookStylePayout = allLegsPriced && watchStake ? combineDecimalBookStyle(legOdds) * watchStake : 0

  // Mirror the server's storage bounds (int4 combined odds, numeric(12,2)
  // payout) so builders find out the slip is too big while they're still
  // building it, not from a failed save.
  const INT4_MAX = 2147483647
  const MAX_PAYOUT = 9_999_999_999.99
  const exceedsStorageBounds =
    allLegsPriced &&
    (!Number.isFinite(combinedOdds) || Math.abs(combinedOdds) > INT4_MAX || potentialPayout > MAX_PAYOUT)

  function onSubmit(values: z.infer<typeof formSchema>) {
    if (!activeUser) return
    if (!values.rationale?.trim() && !rationaleNudged) {
      setRationaleNudged(true)
      return
    }
    const sportsbook = values.sportsbook === "Other" ? (customSportsbook || "Other") : (values.sportsbook || undefined)
    createParlay.mutate({
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
        queryClient.invalidateQueries({ queryKey: getListParlaysQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey({ userId: activeUser.id }) })
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey({ limit: 5 }) })
        queryClient.invalidateQueries({ queryKey: getGetBankrollQueryKey({ userId: activeUser.id }) })
        queryClient.invalidateQueries({ queryKey: getGetNeedsSettlingQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetUserBadgesQueryKey(activeUser.id) })
        queryClient.invalidateQueries({ queryKey: getGetStreaksQueryKey({ userId: activeUser.id }) })
        setLocation("/parlays")
      }
    })
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/parlays")} className="rounded-full">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Parlay</h1>
          <p className="text-muted-foreground mt-1">Build a multi-leg parlay.</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className="bg-card">
            <CardHeader>
              <CardTitle>Parlay Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2 md:col-span-1">
                      <FormLabel>Parlay Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Sunday NFL Slate" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="stake"
                  render={({ field }) => (
                    <FormItem className="col-span-2 md:col-span-1">
                      <FormLabel>Stake ($)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
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
                      Why this parlay?
                      <span className="text-muted-foreground font-normal">(the part future-you reads)</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Why do these picks belong on one ticket? If it's 'the payout looked nice', write that down — it'll be educational later."
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
                  fast path is just: name, stake, legs, log. */}
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
                            <Input placeholder="e.g. 25% parlay boost applied" {...field} />
                          </FormControl>
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
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Legs ({fields.length})</h2>
              <OddsFormatToggle value={oddsFormat} onChange={setOddsFormatPref} />
            </div>

            {fields.map((field, index) => (
              <Card key={field.id} className="relative overflow-hidden bg-muted/20">
                <div className="absolute top-0 left-0 bottom-0 w-1 bg-primary/40"></div>
                <CardHeader className="flex flex-row items-center justify-between py-3 px-4 bg-muted/40 border-b">
                  <div className="font-medium text-sm">Leg {index + 1}</div>
                  {fields.length > 2 && (
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name={`legs.${index}.sport`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Sport</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Sport" />
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
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`legs.${index}.betType`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Bet Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="moneyline">Moneyline</SelectItem>
                              <SelectItem value="spread">Spread</SelectItem>
                              <SelectItem value="total">Total</SelectItem>
                              <SelectItem value="prop">Prop</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name={`legs.${index}.event`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Event</FormLabel>
                        <FormControl>
                          <Input className="h-9" placeholder="e.g. Chiefs @ Raiders" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name={`legs.${index}.pick`}
                      render={({ field }) => (
                        <FormItem className="col-span-1">
                          <FormLabel className="text-xs">Pick</FormLabel>
                          <FormControl>
                            <Input className="h-9" placeholder="Chiefs -3.5" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`legs.${index}.odds`}
                      render={({ field }) => (
                        <FormItem className="col-span-1">
                          <FormLabel className="text-xs">Odds</FormLabel>
                          <FormControl>
                            <OddsInput
                              className="h-9"
                              value={field.value}
                              onChange={field.onChange}
                              format={oddsFormat}
                              data-testid={`input-leg-odds-${index}`}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`legs.${index}.gameDate`}
                      render={({ field }) => (
                        <FormItem className="col-span-1">
                          <FormLabel className="text-xs">Date</FormLabel>
                          <FormControl>
                            <Input className="h-9" type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}

            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed border-primary/40 text-primary hover:bg-primary/10 h-12"
              onClick={() => append(defaultLeg)}
              data-testid="button-add-leg"
            >
              <Plus className="h-4 w-4 mr-2" /> Add Leg {fields.length + 1}
            </Button>
          </div>

          <div className="sticky bottom-0 left-0 right-0 z-10 pt-4 bg-background" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <Card className="border-primary bg-card shadow-lg">
              {tiltSpiral && (
                <div
                  className="mx-4 mt-4 flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-500"
                  data-testid="warning-leak-tilt-spiral"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Pump the brakes. {tiltSpiral.recentLosses} Ls in the last {tiltSpiral.windowHours} hours, {tiltSpiral.rapidPlays} quick plays since, staked {tiltSpiral.stakeRatio}x your usual. A parlay won't get it back faster — the board will still be here tomorrow.
                  </span>
                </div>
              )}
              {createParlay.isError && (
                <div className="mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                  {getApiErrorMessage(createParlay.error, "Couldn't log this parlay. Please check the form and try again.")}
                </div>
              )}
              <CardContent className="p-4 space-y-2">
                {rationaleNudged && !form.watch("rationale")?.trim() && (
                  <div
                    className="flex items-start gap-2.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm"
                    data-testid="nudge-rationale"
                  >
                    <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <span>
                      {fields.length} legs and no why? When this settles you'll be grading a ticket
                      you can't explain. One sentence now — or log it anyway.
                    </span>
                  </div>
                )}
                {exceedsStorageBounds && (
                  <div
                    className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                    role="alert"
                    data-testid="text-odds-bound-warning"
                  >
                    These combined odds are too big to save. Remove a leg or shorten the longest prices before logging.
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="grid grid-cols-2 gap-8">
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">Estimated Odds</div>
                      <div className="text-xl font-bold font-mono text-primary" data-testid="text-combined-odds">
                        {allLegsPriced ? formatAmerican(combinedOdds) : '-'}
                      </div>
                      {allLegsPriced && (
                        <div className="text-xs text-muted-foreground font-mono">
                          {combinedDecimal.toFixed(2)} decimal
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">Est. Payout</div>
                      <div className="text-xl font-bold font-mono" data-testid="text-est-payout">
                        {formatCurrency(potentialPayout)}
                      </div>
                      {allLegsPriced && Math.abs(bookStylePayout - potentialPayout) >= 0.01 && (
                        <div className="text-xs text-muted-foreground font-mono">
                          ~{formatCurrency(bookStylePayout)} at book prices
                        </div>
                      )}
                    </div>
                  </div>
                  <Button type="submit" size="lg" disabled={createParlay.isPending || fields.length < 2 || exceedsStorageBounds} data-testid="button-submit-parlay">
                    {createParlay.isPending
                      ? "Logging..."
                      : rationaleNudged && !form.watch("rationale")?.trim()
                        ? "Log It Anyway"
                        : "Log Parlay"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </form>
      </Form>
    </div>
  )
}
