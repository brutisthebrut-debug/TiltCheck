import { useEffect, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SPORTS, SPORTSBOOKS } from "@/lib/preferences"
import { hasActiveFilters, type ListFilters } from "@/hooks/use-url-filters"

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "push", label: "Push" },
  { value: "void", label: "Void" },
]

const ANY = "__any__"

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

/**
 * Compact filter/search bar shared by the Bets and Parlays lists.
 * Search input is debounced before it hits the URL (and therefore the API).
 */
export function ListFilterBar({ filters, update, clear, mineLabel, searchPlaceholder }: {
  filters: ListFilters
  update: (patch: Partial<ListFilters>) => void
  clear: () => void
  mineLabel: string
  searchPlaceholder: string
}) {
  const [qInput, setQInput] = useState(filters.q)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Keep the input in sync when the URL changes from outside (clear, back nav).
  useEffect(() => {
    setQInput(filters.q)
  }, [filters.q])

  const onSearchChange = (value: string) => {
    setQInput(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => update({ q: value.trim() }), 350)
  }
  useEffect(() => () => clearTimeout(debounceRef.current), [])

  // Non-search filter changes cancel any pending debounce and flush the
  // typed search text alongside, so a stale timer never overwrites the URL.
  const applyUpdate = (patch: Partial<ListFilters>) => {
    clearTimeout(debounceRef.current)
    update({ q: qInput.trim(), ...patch })
  }

  const onClear = () => {
    clearTimeout(debounceRef.current)
    setQInput("")
    clear()
  }

  const active = hasActiveFilters(filters)

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: search + selects + date range */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={qInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8 h-9"
            data-testid="input-list-search"
          />
        </div>
        <Select
          value={filters.sportsbook ?? ANY}
          onValueChange={(v) => applyUpdate({ sportsbook: v === ANY ? null : v })}
        >
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-sportsbook">
            <SelectValue placeholder="Sportsbook" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any book</SelectItem>
            {SPORTSBOOKS.map((sb) => (
              <SelectItem key={sb} value={sb}>{sb}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => applyUpdate({ from: e.target.value })}
            className="h-9 w-[140px] text-xs"
            aria-label="From date"
            data-testid="input-filter-from"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => applyUpdate({ to: e.target.value })}
            className="h-9 w-[140px] text-xs"
            aria-label="To date"
            data-testid="input-filter-to"
          />
        </div>
        {active && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-clear-filters"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Row 2: status + mine + sport chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {STATUS_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            active={filters.status === opt.value}
            onClick={() => applyUpdate({ status: opt.value })}
            testId={`chip-status-${opt.value}`}
          >
            {opt.label}
          </Chip>
        ))}
        <div className="w-px bg-border shrink-0 mx-1" />
        <Chip active={filters.mine} onClick={() => applyUpdate({ mine: !filters.mine })} testId="chip-mine">
          {mineLabel}
        </Chip>
        {SPORTS.map((sport) => (
          <Chip
            key={sport}
            active={filters.sport === sport}
            onClick={() => applyUpdate({ sport: filters.sport === sport ? null : sport })}
            testId={`chip-sport-${sport}`}
          >
            {sport}
          </Chip>
        ))}
      </div>
    </div>
  )
}
