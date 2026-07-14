import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useLocation } from "wouter"
import { useCreateBet, getListBetsQueryKey, getGetStatsSummaryQueryKey, getGetRecentActivityQueryKey, getGetBankrollQueryKey } from "@workspace/api-client-react"
import { useUser } from "@/contexts/UserContext"
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
import { calculatePotentialPayout, formatCurrency } from "@/lib/format"
import { getApiErrorMessage } from "@/lib/api-error"
import { createBetBodyOddsMin, createBetBodyOddsMax } from "@workspace/api-zod"
import { ArrowLeft, ChevronDown } from "lucide-react"

const SPORTSBOOKS = [
  "bet365", "DraftKings", "FanDuel", "BetMGM", "Caesars", "PointsBet", "Hard Rock Bet", "ESPN Bet", "Other"
]

const formSchema = z.object({
  sport: z.string().min(1, "Sport is required"),
  event: z.string().min(1, "Event is required"),
  betType: z.enum(["moneyline", "spread", "total", "prop", "futures"]),
  pick: z.string().min(1, "Pick is required"),
  odds: z.coerce
    .number()
    .int("Odds must be a whole number")
    .min(createBetBodyOddsMin, `Odds must be between ${createBetBodyOddsMin.toLocaleString()} and +${createBetBodyOddsMax.toLocaleString()}`)
    .max(createBetBodyOddsMax, `Odds must be between ${createBetBodyOddsMin.toLocaleString()} and +${createBetBodyOddsMax.toLocaleString()}`),
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
  const [customSportsbook, setCustomSportsbook] = useState("")
  const [showPromo, setShowPromo] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sport: "",
      event: "",
      betType: "moneyline",
      pick: "",
      odds: -110,
      stake: 100,
      gameDate: new Date().toISOString().split('T')[0],
      confidenceScore: 5,
      rationale: "",
      sportsbook: "",
      promoNote: "",
    },
  })

  const watchOdds = form.watch("odds")
  const watchStake = form.watch("stake")
  const watchSportsbook = form.watch("sportsbook")
  
  const potentialPayout = watchStake && watchOdds ? calculatePotentialPayout(watchStake, watchOdds) : 0

  function onSubmit(values: z.infer<typeof formSchema>) {
    if (!activeUser) return
    const sportsbook = values.sportsbook === "Other" ? (customSportsbook || "Other") : (values.sportsbook || undefined)
    createBet.mutate({
      data: {
        userId: activeUser.id,
        ...values,
        sportsbook,
        promoNote: values.promoNote || undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBetsQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey({ userId: activeUser.id }) })
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey({ limit: 5 }) })
        queryClient.invalidateQueries({ queryKey: getGetBankrollQueryKey({ userId: activeUser.id }) })
        setLocation("/bets")
      }
    })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/bets")} className="rounded-full">
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
                      <FormLabel>Odds (American)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="-110" {...field} />
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

              {/* Sportsbook */}
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

              {/* Promo toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowPromo(!showPromo)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${showPromo ? 'rotate-180' : ''}`} />
                  {showPromo ? 'Hide promo / boost note' : 'Add promo / profit-boost note'}
                </button>
                {showPromo && (
                  <FormField
                    control={form.control}
                    name="promoNote"
                    render={({ field }) => (
                      <FormItem className="mt-3">
                        <FormLabel>Promo / Boost Note</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 20% profit boost applied" {...field} />
                        </FormControl>
                        <FormDescription>Note any promotional boost on this bet. You can record the actual payout when you settle.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

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

              <FormField
                control={form.control}
                name="rationale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rationale (Pre-game Notes)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Why are you making this bet? What's the edge?" 
                        className="h-24 resize-none"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t bg-muted/20 px-6 py-4">
              {createBet.isError && (
                <div className="w-full rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                  {getApiErrorMessage(createBet.error, "Couldn't log this bet. Please check the form and try again.")}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={createBet.isPending}>
                {createBet.isPending ? "Logging..." : "Log Bet"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  )
}
