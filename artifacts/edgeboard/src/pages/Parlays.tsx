import { useUser } from "@/contexts/UserContext"
import { useListParlays, getListParlaysQueryKey } from "@workspace/api-client-react"
import { useState, useMemo } from "react"
import { Link } from "wouter"
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/format"
import { formatOddsAs } from "@workspace/odds"
import { useOddsFormat } from "@/hooks/use-odds-format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Plus, Layers } from "lucide-react"

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

export default function Parlays() {
  const { activeUser } = useUser()
  const [oddsFormat] = useOddsFormat()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [myParlays, setMyParlays] = useState(false)
  const [sportFilter, setSportFilter] = useState<string | null>(null)
  
  const { data: parlays = [], isLoading } = useListParlays(
    {}, 
    { query: { queryKey: getListParlaysQueryKey() } }
  )

  const sports = useMemo(() => {
    const set = new Set(parlays.flatMap(p => p.legs?.map(l => l.sport) ?? []))
    return Array.from(set).sort()
  }, [parlays])

  const filteredParlays = useMemo(() => parlays.filter(parlay => {
    if (myParlays && parlay.userId !== activeUser?.id) return false
    if (statusFilter !== 'all' && parlay.status !== statusFilter) return false
    if (sportFilter && !parlay.legs?.some(l => l.sport === sportFilter)) return false
    return true
  }), [parlays, myParlays, statusFilter, sportFilter, activeUser])

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
          <h1 className="text-3xl font-bold tracking-tight">Parlays</h1>
          <p className="text-muted-foreground mt-1">Track multi-leg bets and longshots.</p>
        </div>
        <Button asChild>
          <Link href="/parlays/new">
            <Plus className="mr-2 h-4 w-4" />
            New Parlay
          </Link>
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {statusOptions.map(opt => (
          <Chip key={opt.value} active={statusFilter === opt.value} onClick={() => setStatusFilter(opt.value)}>
            {opt.label}
          </Chip>
        ))}
        <div className="w-px bg-border shrink-0 mx-1" />
        <Chip active={myParlays} onClick={() => setMyParlays(!myParlays)}>
          My Parlays
        </Chip>
        {sports.map(sport => (
          <Chip key={sport} active={sportFilter === sport} onClick={() => setSportFilter(sportFilter === sport ? null : sport)}>
            {sport}
          </Chip>
        ))}
      </div>

      {!isLoading && parlays.length === 0 ? (
        <Card className="border-dashed border-2 border-muted">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              <Layers className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No parlays logged yet</h2>
              <p className="text-muted-foreground text-sm mt-1">Group multiple picks into a parlay to track bigger swings.</p>
            </div>
            <Button asChild>
              <Link href="/parlays/new"><Plus className="h-4 w-4 mr-1" />Log First Parlay</Link>
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
                  <TableHead>Name</TableHead>
                  <TableHead>Legs</TableHead>
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
                      <TableCell><div className="h-4 w-12 bg-muted animate-pulse rounded"></div></TableCell>
                      <TableCell><div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto"></div></TableCell>
                      <TableCell><div className="h-6 w-16 bg-muted animate-pulse rounded-full"></div></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                ) : filteredParlays.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <p>No parlays match the current filters.</p>
                        <button
                          onClick={() => { setStatusFilter('all'); setMyParlays(false); setSportFilter(null) }}
                          className="text-primary text-sm underline-offset-2 hover:underline"
                        >
                          Clear filters
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredParlays.map(parlay => (
                    <TableRow key={parlay.id} className="group cursor-pointer hover:bg-muted/50" onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('button')) {
                        window.location.href = `/parlays/${parlay.id}`
                      }
                    }}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(parlay.createdAt)}</TableCell>
                      <TableCell className="font-medium">{parlay.userName}</TableCell>
                      <TableCell className="font-semibold">{parlay.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{parlay.legs?.length || 0} legs</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-primary">{formatOddsAs(parlay.odds, oddsFormat)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(parlay.stake)}</TableCell>
                      <TableCell>
                        <Badge variant={parlay.status as any}>{parlay.status.toUpperCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <Link href={`/parlays/${parlay.id}`}>View</Link>
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
