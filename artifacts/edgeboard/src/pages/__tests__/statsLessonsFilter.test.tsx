// @vitest-environment jsdom
//
// Lessons section of Stats.tsx — filter wiring tests.
//
// Guards against silent regressions where a sport or range selection changes
// the visible label but leaves the actual hook params (and therefore the
// fetched data) untouched, or where the "Not much to learn from this slice"
// empty state stops rendering for a filtered slice with fewer than 3 reviews.

import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import Stats from "../Stats"

// ── Recharts stub (no SVG in jsdom) ───────────────────────────────────────────

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Cell: () => null,
}))

// ── Replace Radix Select with a native <select> so fireEvent.change works ─────

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <select
      data-testid="select-lessons-sport"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}))

// ── Generated hook mocks ───────────────────────────────────────────────────────

const mockUseGetStatsSummary = vi.fn()
const mockUseGetStatsBySport = vi.fn()
const mockUseGetConfidenceAnalysis = vi.fn()
const mockUseGetStatsInsights = vi.fn()

vi.mock("@workspace/api-client-react", () => ({
  useGetStatsSummary: (...args: unknown[]) => mockUseGetStatsSummary(...args),
  useGetStatsBySport: (...args: unknown[]) => mockUseGetStatsBySport(...args),
  useGetConfidenceAnalysis: (...args: unknown[]) => mockUseGetConfidenceAnalysis(...args),
  useGetStatsInsights: (...args: unknown[]) => mockUseGetStatsInsights(...args),
  useGetStatsPeerBenchmarks: () => ({ data: undefined, isLoading: false }),
  getGetStatsSummaryQueryKey: (p: unknown) => ["stats-summary", p],
  getGetStatsBySportQueryKey: (p: unknown) => ["stats-by-sport", p],
  getGetConfidenceAnalysisQueryKey: (p: unknown) => ["confidence-analysis", p],
  getGetStatsInsightsQueryKey: (p: unknown) => ["stats-insights", p],
  getGetStatsPeerBenchmarksQueryKey: () => ["stats-peer-benchmarks"],
}))

// ── Stub share utilities so html2canvas never runs in tests ───────────────────
vi.mock("@/lib/shareCard", () => ({
  exportAndShare: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/components/StatsShareCard", () => ({
  StatsShareCard: vi.fn().mockReturnValue(null),
  StatsShareCardPortrait: vi.fn().mockReturnValue(null),
}))

vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({
    activeUser: { id: 7, displayName: "Test Bettor" },
    allUsers: [],
    isLoading: false,
    needsClaim: false,
    refreshUser: () => {},
  }),
}))

vi.mock("@/hooks/use-pro", () => ({
  useProStatus: () => ({ isPro: true, isProLoading: false, isProUnknown: false }),
}))

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>()
  return {
    ...actual,
    useParams: () => ({}),
    useLocation: () => ["/stats", vi.fn()],
    Link: ({
      href,
      children,
      ...props
    }: {
      href: string
      children: React.ReactNode
      [k: string]: unknown
    }) => (
      <a href={href} {...props}>
        {children}
      </a>
    ),
  }
})

// @workspace/weeks — fixed reference date so "since" values are deterministic
vi.mock("@workspace/weeks", () => ({
  dayOf: () => "2026-07-15",
  addDays: (_base: string, n: number) => {
    // n is always negative (-30 or -90)
    if (n === -30) return "2026-06-15"
    if (n === -90) return "2026-04-16"
    return "2026-01-01"
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function queryOk<T>(data: T) {
  return { data, isLoading: false, isError: false, refetch: vi.fn(), isRefetching: false }
}

/** Summary with enough graded bets to pass the 5-bet threshold */
const summary = {
  straightBetRecord: { wins: 4, losses: 3, pushes: 0 },
  parlayRecord: { wins: 1, losses: 1, pushes: 0 },
  bestBetProfit: 120,
  avgOdds: -108,
  pending: 0,
}

const sportStats = [
  { sport: "NFL", wins: 3, losses: 2, pushes: 0, winRate: 60, totalWagered: 500, profit: 50, roi: 10 },
  { sport: "NBA", wins: 1, losses: 1, pushes: 0, winRate: 50, totalWagered: 200, profit: -10, roi: -5 },
]

/** Insights with enough reviews to show the full panel */
const richInsights = {
  reviewedCount: 5,
  lossesWithReason: 3,
  missReasons: [{ reason: "emotional", count: 2 }],
  soundReasoning: { winRate: 65, wins: 3, total: 5 },
  flawedReasoning: { winRate: 40, wins: 2, total: 5 },
  recentNotes: [],
}

/** Insights with too few reviews for the filter slice */
const thinInsights = { reviewedCount: 1, lossesWithReason: 0, missReasons: [], soundReasoning: { winRate: 0, wins: 0, total: 0 }, flawedReasoning: { winRate: 0, wins: 0, total: 0 }, recentNotes: [] }

/** No reviews at all */
const emptyInsights = { reviewedCount: 0, lossesWithReason: 0, missReasons: [], soundReasoning: { winRate: 0, wins: 0, total: 0 }, flawedReasoning: { winRate: 0, wins: 0, total: 0 }, recentNotes: [] }

function renderStats() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Stats />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  mockUseGetStatsSummary.mockReturnValue(queryOk(summary))
  mockUseGetStatsBySport.mockReturnValue(queryOk(sportStats))
  mockUseGetConfidenceAnalysis.mockReturnValue(queryOk([]))
  mockUseGetStatsInsights.mockReturnValue(queryOk(richInsights))
})

// ── Range param wiring ────────────────────────────────────────────────────────

describe("Lessons range filter wiring", () => {
  it("calls the hook with no since param on initial render (all-time)", () => {
    renderStats()
    // The very first call should have userId but no since/sport
    const firstCall = mockUseGetStatsInsights.mock.calls[0]
    expect(firstCall[0]).toEqual({ userId: 7 })
  })

  it("adds since=2026-06-15 when 30d is selected", () => {
    renderStats()
    mockUseGetStatsInsights.mockClear()

    fireEvent.click(screen.getByTestId("button-stats-range-30"))

    // Hook must have been re-invoked with the since param
    const lastCall = mockUseGetStatsInsights.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ userId: 7, since: "2026-06-15" })
  })

  it("adds since=2026-04-16 when 90d is selected", () => {
    renderStats()
    mockUseGetStatsInsights.mockClear()

    fireEvent.click(screen.getByTestId("button-stats-range-90"))

    const lastCall = mockUseGetStatsInsights.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ userId: 7, since: "2026-04-16" })
  })

  it("removes the since param when switching back to all-time", () => {
    renderStats()

    fireEvent.click(screen.getByTestId("button-stats-range-30"))
    mockUseGetStatsInsights.mockClear()

    fireEvent.click(screen.getByTestId("button-stats-range-all"))

    const lastCall = mockUseGetStatsInsights.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ userId: 7 })
  })

  it("query key includes since so React Query treats filtered/unfiltered as separate cache entries", () => {
    renderStats()
    mockUseGetStatsInsights.mockClear()

    fireEvent.click(screen.getByTestId("button-stats-range-30"))

    const lastCall = mockUseGetStatsInsights.mock.calls.at(-1)
    // Second arg is the query options; its queryKey must contain the since value
    const queryKey: unknown[] = lastCall?.[1]?.query?.queryKey ?? []
    const keyStr = JSON.stringify(queryKey)
    expect(keyStr).toContain("2026-06-15")
  })
})

// ── Sport param wiring ────────────────────────────────────────────────────────

describe("Lessons sport filter wiring", () => {
  it("adds sport param when a sport is selected", () => {
    renderStats()
    mockUseGetStatsInsights.mockClear()

    fireEvent.change(screen.getByTestId("select-lessons-sport"), {
      target: { value: "NFL" },
    })

    const lastCall = mockUseGetStatsInsights.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ userId: 7, sport: "NFL" })
  })

  it("removes sport param when all-sports is selected again", () => {
    renderStats()

    fireEvent.change(screen.getByTestId("select-lessons-sport"), {
      target: { value: "NFL" },
    })
    mockUseGetStatsInsights.mockClear()

    fireEvent.change(screen.getByTestId("select-lessons-sport"), {
      target: { value: "all" },
    })

    const lastCall = mockUseGetStatsInsights.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ userId: 7 })
  })

  it("combines sport and since when both filters are active", () => {
    renderStats()
    mockUseGetStatsInsights.mockClear()

    fireEvent.change(screen.getByTestId("select-lessons-sport"), {
      target: { value: "NBA" },
    })
    fireEvent.click(screen.getByTestId("button-stats-range-90"))

    const lastCall = mockUseGetStatsInsights.mock.calls.at(-1)
    expect(lastCall?.[0]).toEqual({ userId: 7, sport: "NBA", since: "2026-04-16" })
  })
})

// ── Filtered empty state ──────────────────────────────────────────────────────

describe("Lessons filtered empty state (card-lessons-empty)", () => {
  it("shows card-lessons-empty when the filtered slice has fewer than 3 reviews", () => {
    mockUseGetStatsInsights.mockReturnValue(queryOk(thinInsights))
    renderStats()

    fireEvent.click(screen.getByTestId("button-stats-range-30"))

    expect(screen.getByTestId("card-lessons-empty")).toBeTruthy()
  })

  it("shows 'Not much to learn from this slice' copy when filtered", () => {
    mockUseGetStatsInsights.mockReturnValue(queryOk(thinInsights))
    renderStats()

    fireEvent.click(screen.getByTestId("button-stats-range-30"))

    expect(screen.getByText("Not much to learn from this slice")).toBeTruthy()
  })

  it("shows card-lessons-empty when the unfiltered slice also has fewer than 3 reviews", () => {
    mockUseGetStatsInsights.mockReturnValue(queryOk(emptyInsights))
    renderStats()

    expect(screen.getByTestId("card-lessons-empty")).toBeTruthy()
  })

  it("does NOT show card-lessons-empty when reviewedCount >= 3", () => {
    // richInsights has reviewedCount=5; default mock already returns it
    renderStats()

    expect(screen.queryByTestId("card-lessons-empty")).toBeNull()
  })
})

// ── Parlays-excluded note ─────────────────────────────────────────────────────

describe("text-lessons-sport-note (parlays excluded disclaimer)", () => {
  it("renders when a sport is selected and there are enough insights", () => {
    // richInsights has enough reviews; mock stays in place from beforeEach
    renderStats()

    fireEvent.change(screen.getByTestId("select-lessons-sport"), {
      target: { value: "NFL" },
    })

    expect(screen.getByTestId("text-lessons-sport-note")).toBeTruthy()
    expect(screen.getByTestId("text-lessons-sport-note").textContent).toContain("NFL")
    expect(screen.getByTestId("text-lessons-sport-note").textContent).toContain(
      "straight bets only",
    )
  })

  it("does NOT render when all-sports is selected (even with enough insights)", () => {
    renderStats()

    // sport is "all" by default — note should be absent
    expect(screen.queryByTestId("text-lessons-sport-note")).toBeNull()
  })

  it("does NOT render when the sport slice has too few reviews to show the panel", () => {
    mockUseGetStatsInsights.mockReturnValue(queryOk(thinInsights))
    renderStats()

    fireEvent.change(screen.getByTestId("select-lessons-sport"), {
      target: { value: "NFL" },
    })

    // The empty state card should show instead, and the note should be absent
    expect(screen.getByTestId("card-lessons-empty")).toBeTruthy()
    expect(screen.queryByTestId("text-lessons-sport-note")).toBeNull()
  })
})
