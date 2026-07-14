import { useUser } from "@/contexts/UserContext"
import { useListParlays, getListParlaysQueryKey } from "@workspace/api-client-react"
import { useState } from "react"
import { Link } from "wouter"
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatOdds, formatDate } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Plus, Search } from "lucide-react"

export default function Parlays() {
  const { activeUser } = useUser()
  const [filter, setFilter] = useState("all")
  
  const { data: parlays = [], isLoading } = useListParlays(
    {}, 
    { query: { queryKey: getListParlaysQueryKey() } }
  )

  const filteredParlays = parlays.filter(parlay => {
    if (filter === "all") return true
    if (filter === "my") return parlay.userId === activeUser?.id
    if (filter === "pending") return parlay.status === "pending"
    return true
  })

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

      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex items-center gap-2 border rounded-md p-1 bg-card">
          <Button 
            variant={filter === "all" ? "secondary" : "ghost"} 
            size="sm" 
            onClick={() => setFilter("all")}
            className="text-xs"
          >
            All Workspace
          </Button>
          <Button 
            variant={filter === "my" ? "secondary" : "ghost"} 
            size="sm"
            onClick={() => setFilter("my")}
            className="text-xs"
          >
            My Parlays
          </Button>
          <Button 
            variant={filter === "pending" ? "secondary" : "ghost"} 
            size="sm"
            onClick={() => setFilter("pending")}
            className="text-xs"
          >
            Pending
          </Button>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            type="search" 
            placeholder="Search parlays..." 
            className="pl-8 bg-card"
          />
        </div>
      </div>

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
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No parlays found.
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
                    <TableCell className="font-mono text-primary">{formatOdds(parlay.odds)}</TableCell>
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
    </div>
  )
}
