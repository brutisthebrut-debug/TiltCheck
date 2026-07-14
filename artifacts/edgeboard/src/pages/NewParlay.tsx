import { useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useLocation } from "wouter"
import { useCreateParlay, getListParlaysQueryKey, getGetStatsSummaryQueryKey, getGetRecentActivityQueryKey, getGetBankrollQueryKey } from "@workspace/api-client-react"
import { useUser } from "@/contexts/UserContext"
import { useQueryClient } from "@tanstack/react-query"
import { 
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage 
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { calculatePotentialPayout, formatCurrency } from "@/lib/format"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"

const legSchema = z.object({
  sport: z.string().min(1, "Sport is required"),
  event: z.string().min(1, "Event is required"),
  betType: z.enum(["moneyline", "spread", "total", "prop"]),
  pick: z.string().min(1, "Pick is required"),
  odds: z.coerce.number().int("Odds must be an integer"),
  gameDate: z.string().min(1, "Game date is required"),
})

const formSchema = z.object({
  name: z.string().min(1, "Parlay name is required"),
  stake: z.coerce.number().positive("Stake must be greater than 0"),
  confidenceScore: z.number().min(1).max(10),
  rationale: z.string().optional(),
  legs: z.array(legSchema).min(2, "At least 2 legs are required"),
})

export default function NewParlay() {
  const { activeUser } = useUser()
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()
  const createParlay = useCreateParlay()

  const defaultLeg = {
    sport: "NFL",
    event: "",
    betType: "moneyline" as const,
    pick: "",
    odds: -110,
    gameDate: new Date().toISOString().split('T')[0],
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      stake: 50,
      confidenceScore: 3,
      rationale: "",
      legs: [defaultLeg, defaultLeg],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "legs",
  })

  const watchLegs = form.watch("legs")
  const watchStake = form.watch("stake")
  
  // Calculate combined odds roughly (this is an approximation for American odds)
  // Converting to decimal odds, multiplying, then converting back to American
  const calculateCombinedOdds = (legs: Array<{ odds: number }>) => {
    if (legs.length === 0) return 0
    if (legs.some(leg => !leg.odds)) return 0
    
    let combinedDecimal = 1
    for (const leg of legs) {
      if (leg.odds < 0) {
        combinedDecimal *= (100 / Math.abs(leg.odds)) + 1
      } else if (leg.odds > 0) {
        combinedDecimal *= (leg.odds / 100) + 1
      }
    }
    
    if (combinedDecimal <= 1) return 0
    
    if (combinedDecimal >= 2) {
      return Math.round((combinedDecimal - 1) * 100)
    } else {
      return Math.round(-100 / (combinedDecimal - 1))
    }
  }

  const combinedOdds = calculateCombinedOdds(watchLegs)
  const potentialPayout = watchStake && combinedOdds !== 0 ? calculatePotentialPayout(watchStake, combinedOdds) : 0

  function onSubmit(values: z.infer<typeof formSchema>) {
    if (!activeUser) return

    createParlay.mutate({
      data: {
        userId: activeUser.id,
        ...values,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListParlaysQueryKey() })
        queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey({ userId: activeUser.id }) })
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey({ limit: 5 }) })
        queryClient.invalidateQueries({ queryKey: getGetBankrollQueryKey({ userId: activeUser.id }) })
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                        placeholder="Why are you grouping these picks?" 
                        className="h-20 resize-none"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Legs ({fields.length})</h2>
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                onClick={() => append(defaultLeg)}
              >
                <Plus className="h-4 w-4 mr-2" /> Add Leg
              </Button>
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
                            <Input className="h-9" type="number" placeholder="-110" {...field} />
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
          </div>

          <div className="sticky bottom-0 left-0 right-0 z-10 pt-4 bg-background pb-safe">
            <Card className="border-primary bg-card shadow-lg">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Estimated Odds</div>
                    <div className="text-xl font-bold font-mono text-primary">
                      {combinedOdds > 0 ? `+${combinedOdds}` : combinedOdds === 0 ? '-' : combinedOdds}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Est. Payout</div>
                    <div className="text-xl font-bold font-mono">
                      {formatCurrency(potentialPayout)}
                    </div>
                  </div>
                </div>
                <Button type="submit" size="lg" disabled={createParlay.isPending || fields.length < 2}>
                  {createParlay.isPending ? "Logging..." : "Log Parlay"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </form>
      </Form>
    </div>
  )
}
