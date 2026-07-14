import { useUser } from "@/contexts/UserContext"
import { useGetBankroll, useListTransactions, getGetBankrollQueryKey, getListTransactionsQueryKey, useCreateTransaction } from "@workspace/api-client-react"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { formatCurrency, formatDate } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Wallet, ArrowUpRight, ArrowDownRight, Activity } from "lucide-react"

export default function Bankroll() {
  const { activeUser } = useUser()
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [type, setType] = useState<"deposit" | "withdraw" | "adjustment">("deposit")
  const [note, setNote] = useState("")

  const { data: bankroll, isLoading: isBankrollLoading } = useGetBankroll(
    { userId: activeUser?.id },
    { query: { enabled: !!activeUser?.id, queryKey: getGetBankrollQueryKey({ userId: activeUser?.id }) } }
  )

  const { data: transactions = [], isLoading: isTxLoading } = useListTransactions(
    { userId: activeUser?.id, limit: 20 },
    { query: { enabled: !!activeUser?.id, queryKey: getListTransactionsQueryKey({ userId: activeUser?.id, limit: 20 }) } }
  )

  const createTx = useCreateTransaction()

  const handleTransaction = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeUser || !amount || isNaN(Number(amount))) return

    createTx.mutate({
      data: {
        userId: activeUser.id,
        type,
        amount: Number(amount),
        note: note || undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBankrollQueryKey({ userId: activeUser.id }) })
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey({ userId: activeUser.id, limit: 20 }) })
        setIsOpen(false)
        setAmount("")
        setNote("")
        setType("deposit")
      }
    })
  }

  const isLoading = isBankrollLoading || isTxLoading

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Bankroll</h1>
        <Card className="animate-pulse bg-muted/50 h-48" />
        <Card className="animate-pulse bg-muted/50 h-96" />
      </div>
    )
  }

  if (!bankroll) return null

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bankroll</h1>
          <p className="text-muted-foreground mt-1">Manage your funds and track cash flow.</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>Update Balance</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update Bankroll</DialogTitle>
              <DialogDescription>
                Record a deposit, withdrawal, or manual adjustment.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleTransaction} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Transaction Type</Label>
                <Select value={type} onValueChange={(val: any) => setType(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deposit">Deposit</SelectItem>
                    <SelectItem value="withdraw">Withdraw</SelectItem>
                    <SelectItem value="adjustment">Manual Adjustment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  min="0.01" 
                  value={amount} 
                  onChange={(e) => setAmount(e.target.value)} 
                  placeholder="100.00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Note (Optional)</Label>
                <Input 
                  value={note} 
                  onChange={(e) => setNote(e.target.value)} 
                  placeholder="e.g. Weekly reload"
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createTx.isPending}>
                  {createTx.isPending ? "Processing..." : "Confirm"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 bg-card border-primary/20 bg-primary/5">
          <CardContent className="p-8">
            <div className="flex flex-col md:flex-row justify-between items-center gap-8">
              <div className="text-center md:text-left">
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-center md:justify-start gap-2">
                  <Wallet className="h-4 w-4" /> Current Balance
                </div>
                <div className="text-5xl md:text-6xl font-bold font-mono text-primary">
                  {formatCurrency(bankroll.currentBalance)}
                </div>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full bg-background border">
                  <span>Net P/L:</span>
                  <span className={bankroll.netProfitLoss > 0 ? "text-green-500" : bankroll.netProfitLoss < 0 ? "text-red-500" : ""}>
                    {bankroll.netProfitLoss > 0 ? '+' : ''}{formatCurrency(bankroll.netProfitLoss)}
                  </span>
                </div>
              </div>
              
              <div className="w-full md:w-px md:h-32 bg-border"></div>
              
              <div className="grid grid-cols-2 gap-x-8 gap-y-6 text-center md:text-left w-full md:w-auto">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Starting Balance</div>
                  <div className="text-xl font-mono font-medium">{formatCurrency(bankroll.startingBalance)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total ROI</div>
                  <div className={`text-xl font-mono font-bold ${bankroll.roi > 0 ? 'text-green-500' : bankroll.roi < 0 ? 'text-red-500' : ''}`}>
                    {bankroll.roi > 0 ? '+' : ''}{bankroll.roi.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><ArrowUpRight className="h-3 w-3 text-green-500"/> Deposited</div>
                  <div className="text-lg font-mono">{formatCurrency(bankroll.totalDeposited)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><ArrowDownRight className="h-3 w-3 text-red-500"/> Withdrawn</div>
                  <div className="text-lg font-mono">{formatCurrency(bankroll.totalWithdrawn)}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>Recent changes to your bankroll</CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border border-dashed rounded-md">
              No transactions yet. Add funds or settle bets to see activity.
            </div>
          ) : (
            <div className="space-y-4">
              {transactions.map((tx) => {
                const isPositive = ['deposit', 'bet_win', 'bet_push', 'adjustment'].includes(tx.type) && tx.amount > 0;
                
                return (
                  <div key={tx.id} className="flex items-center justify-between py-3 border-b last:border-0 last:pb-0">
                    <div className="flex items-center gap-4">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                        tx.type === 'deposit' ? 'bg-green-500/10 text-green-500' :
                        tx.type === 'withdraw' ? 'bg-red-500/10 text-red-500' :
                        tx.type === 'bet_win' ? 'bg-primary/10 text-primary' :
                        tx.type === 'bet_loss' ? 'bg-muted text-muted-foreground' :
                        'bg-blue-500/10 text-blue-500'
                      }`}>
                        {tx.type === 'deposit' ? <ArrowUpRight className="h-5 w-5" /> :
                         tx.type === 'withdraw' ? <ArrowDownRight className="h-5 w-5" /> :
                         <Activity className="h-5 w-5" />}
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {tx.type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                          {tx.referenceType && (
                            <Badge variant="outline" className="text-[10px] h-5 px-1">{tx.referenceType}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex gap-2">
                          <span>{formatDate(tx.createdAt)}</span>
                          {tx.note && <span>• {tx.note}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono font-bold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                        {isPositive ? '+' : tx.type === 'withdraw' || tx.type === 'bet_loss' ? '-' : ''}
                        {formatCurrency(tx.amount)}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        Bal: {formatCurrency(tx.balanceAfter)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
