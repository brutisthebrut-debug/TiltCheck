import { useUser } from "@/contexts/UserContext"
import { useListBets, getListBetsQueryKey } from "@workspace/api-client-react"
import { useState, useMemo } from "react"
import { Link } from "wouter"
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatOdds, formatDate } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Plus, ClipboardList } from "lucide-react"

type StatusFilter = 'all' | 'pending' | 'won' | 'lost' | 'push' | 'void'

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

export default function Bets() {
  const { activeUser } = useUser()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [myBets, setMyBets] = useState(false)
  const [sportFilter, setSportFilter] = useState<string | null>(null)
  
  const { data: bets = [], isLoading } = useListBets(
    {}, 
    { query: { queryKey: getListBetsQueryKey() } }
  )

  const sports = useMemo(() => {
    const set = new Set(bets.map(b => b.sport))
    return Array.from(set).sort()
  }, [bets])

  const filteredBets = useMemo(() => bets.filter(bet => {
    if (myBets && bet.userId !== activeUser?.id) return false
    if (statusFilter !== 'all' && bet.status !== statusFilter) return false
    if (sportFilter && bet.sport !== sportFilter) return false
    return true
  }), [bets, myBets, statusFilter, sportFilter, activeUser])

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'won', label: 'Won' },
    { value: 'lost', label: 'Lost' },
    { value: 'push', label: 'Push' },
    { value: 'void', label: 'Void' },
  ]

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Straight Bets</h1>
          <p className="text-muted-foreground mt-1">Track and review your individual plays.</p>
        </div>
        <Button asChild>
          <Link href="/bets/new">
            <Plus className="mr-2 h-4 w-4" />
            New Bet
          </Link>
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {statusOptions.map(opt => (
            <Chip key={opt.value} active={statusFilter === opt.value} onClick={() => setStatusFilter(opt.value)}>
              {opt.label}
            </Chip>
          ))}
          <div className="w-px bg-border shrink-0 mx-1" />
          <Chip active={myBets} onClick={() => setMyBets(!myBets)}>
            My Bets
          </Chip>
          {sports.map(sport => (
            <Chip key={sport} active={sportFilter === sport} onClick={() => setSportFilter(sportFilter === sport ? null : sport)}>
              {sport}
            </Chip>
          ))}
        </div>
      </div>

      {!isLoading && bets.length === 0 ? (
        <Card className="border-dashed border-2 border-muted">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              <ClipboardList className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No bets logged yet</h2>
              <p className="text-muted-foreground text-sm mt-1">Log your first straight bet to start tracking your edge.</p>
            </div>
            <Button asChild>
              <Link href="/bets/new"><Plus className="h-4 w-4 mr-1" />Log First Bet</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Bettor</TableHead>
                  <TableHead>Play</TableHead>
                  <TableHead>Odds</TableHead>
                  <TableHead className="text-right">Stake</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [1, 2, 3].map(i => (
                    <TableRow key={i}>
                      <TableCell><div className="h-4 w-20 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-24 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-32 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-12 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto"></div></TableCell>
                      <TableCell><div className="h-6 w-16 bg-muted animate-pulse rounded-full"></div></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                ) : filteredBets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <p>No bets match the current filters.</p>
                        <button 
                          onClick={() => { setStatusFilter('all'); setMyBets(false); setSportFilter(null) }}
                          className="text-primary text-sm underline-offset-2 hover:underline"
                        >
                          Clear filters
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBets.map(bet => (
                    <TableRow key={bet.id} className="group cursor-pointer hover:bg-muted/50" onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('button')) {
                        window.location.href = `/bets/${bet.id}`
                      }
                    }}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(bet.gameDate)}</TableCell>
                      <TableCell className="font-medium">{bet.userName}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold">{bet.pick}</span>
                          <span className="text-xs text-muted-foreground">{bet.event} · {bet.betType}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">{formatOdds(bet.odds)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(bet.stake)}</TableCell>
                      <TableCell>
                        <Badge variant={bet.status as any}>{bet.status.toUpperCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <Link href={`/bets/${bet.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  )
}
