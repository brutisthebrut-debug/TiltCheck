import { useCallback, useMemo } from "react"
import { useLocation, useSearch } from "wouter"

export type ListFilters = {
  status: string
  mine: boolean
  sport: string | null
  sportsbook: string | null
  q: string
  from: string
  to: string
  // Edge Finder drill-down filters (deep-linked, no dedicated form controls)
  oddsMin: string
  oddsMax: string
  day: string | null
  stakeMin: string
  stakeMax: string
}

export const EMPTY_FILTERS: ListFilters = {
  status: "all",
  mine: false,
  sport: null,
  sportsbook: null,
  q: "",
  from: "",
  to: "",
  oddsMin: "",
  oddsMax: "",
  day: null,
  stakeMin: "",
  stakeMax: "",
}

export function hasActiveFilters(f: ListFilters): boolean {
  return (
    f.status !== "all" || f.mine || f.sport != null || f.sportsbook != null ||
    f.q !== "" || f.from !== "" || f.to !== "" ||
    f.oddsMin !== "" || f.oddsMax !== "" || f.day != null ||
    f.stakeMin !== "" || f.stakeMax !== ""
  )
}

/**
 * List filters synced to the URL query string so filtered views are
 * shareable and survive reloads/back navigation. `update` patches filters
 * (replace, not push, so typing in search doesn't spam history).
 */
export function useUrlFilters(basePathname: string): {
  filters: ListFilters
  update: (patch: Partial<ListFilters>) => void
  clear: () => void
} {
  const search = useSearch()
  const [, setLocation] = useLocation()

  const filters = useMemo<ListFilters>(() => {
    const p = new URLSearchParams(search)
    return {
      status: p.get("status") ?? "all",
      mine: p.get("mine") === "1",
      sport: p.get("sport"),
      sportsbook: p.get("book"),
      q: p.get("q") ?? "",
      from: p.get("from") ?? "",
      to: p.get("to") ?? "",
      oddsMin: p.get("oddsMin") ?? "",
      oddsMax: p.get("oddsMax") ?? "",
      day: p.get("day"),
      stakeMin: p.get("stakeMin") ?? "",
      stakeMax: p.get("stakeMax") ?? "",
    }
  }, [search])

  const update = useCallback(
    (patch: Partial<ListFilters>) => {
      const next = { ...filters, ...patch }
      const p = new URLSearchParams()
      if (next.status !== "all") p.set("status", next.status)
      if (next.mine) p.set("mine", "1")
      if (next.sport) p.set("sport", next.sport)
      if (next.sportsbook) p.set("book", next.sportsbook)
      if (next.q) p.set("q", next.q)
      if (next.from) p.set("from", next.from)
      if (next.to) p.set("to", next.to)
      if (next.oddsMin) p.set("oddsMin", next.oddsMin)
      if (next.oddsMax) p.set("oddsMax", next.oddsMax)
      if (next.day) p.set("day", next.day)
      if (next.stakeMin) p.set("stakeMin", next.stakeMin)
      if (next.stakeMax) p.set("stakeMax", next.stakeMax)
      const qs = p.toString()
      setLocation(qs ? `${basePathname}?${qs}` : basePathname, { replace: true })
    },
    [filters, setLocation, basePathname],
  )

  const clear = useCallback(() => {
    setLocation(basePathname, { replace: true })
  }, [setLocation, basePathname])

  return { filters, update, clear }
}
