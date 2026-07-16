// @vitest-environment jsdom
//
// Share-card preview modal on Stats.tsx.
//
// Guards the confirm-before-export flow: clicking "Share my stats" must open
// the preview dialog (NOT immediately export), the Download/Share button in
// the dialog triggers the actual export, and Cancel dismisses with no export.

import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import Stats from "../Stats"

// jsdom has no ResizeObserver (used by the scaled preview)
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub)

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

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: () => null,
  SelectItem: () => null,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}))

// ── Generated hook mocks ──────────────────────────────────────────────────────

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
const mockExportAndShare = vi.fn().mockResolvedValue(undefined)
const mockExportToClipboard = vi.fn().mockResolvedValue(undefined)
const mockCanCopyImage = vi.fn().mockReturnValue(true)
vi.mock("@/lib/shareCard", () => ({
  exportAndShare: (...args: unknown[]) => mockExportAndShare(...args),
  exportToClipboard: (...args: unknown[]) => mockExportToClipboard(...args),
  canCopyImage: () => mockCanCopyImage(),
}))

vi.mock("@/components/StatsShareCard", async () => {
  const { forwardRef } = await import("react")
  return {
    // Forward the ref so cardRef.current is a real element and export can run
    StatsShareCard: forwardRef<HTMLDivElement>((_props, ref) => (
      <div ref={ref} data-testid="stats-share-card" />
    )),
    StatsShareCardPortrait: forwardRef<HTMLDivElement>((_props, ref) => (
      <div ref={ref} data-testid="stats-share-card-portrait" />
    )),
  }
})

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

vi.mock("@workspace/weeks", () => ({
  dayOf: () => "2026-07-15",
  addDays: () => "2026-06-15",
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function queryOk<T>(data: T) {
  return { data, isLoading: false, isError: false, refetch: vi.fn(), isRefetching: false }
}

const summary = {
  straightBetRecord: { wins: 4, losses: 3, pushes: 0 },
  parlayRecord: { wins: 1, losses: 1, pushes: 0 },
  bestBetProfit: 120,
  avgOdds: -108,
  pending: 0,
  roi: 8.2,
  winRate: 55.6,
  currentStreak: 2,
  currentStreakType: "win",
  totalWagered: 700,
}

const sportStats = [
  { sport: "NFL", wins: 3, losses: 2, pushes: 0, winRate: 60, totalWagered: 500, profit: 50, roi: 10 },
]

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
  mockUseGetStatsInsights.mockReturnValue(queryOk(undefined))
})

describe("Share preview modal", () => {
  it("clicking 'Share my stats' opens the preview dialog without exporting", () => {
    renderStats()

    expect(screen.queryByTestId("dialog-share-preview")).toBeNull()

    fireEvent.click(screen.getByTestId("button-share-stats"))

    expect(screen.getByTestId("dialog-share-preview")).toBeTruthy()
    expect(mockExportAndShare).not.toHaveBeenCalled()
  })

  it("confirming from the dialog triggers the export and closes the dialog", async () => {
    renderStats()

    fireEvent.click(screen.getByTestId("button-share-stats"))
    fireEvent.click(screen.getByTestId("button-share-confirm"))

    await waitFor(() => expect(mockExportAndShare).toHaveBeenCalledTimes(1))
    // Filename derives from the display name
    expect(mockExportAndShare.mock.calls[0][1]).toBe("tiltcheck-test-bettor.png")
    await waitFor(() => expect(screen.queryByTestId("dialog-share-preview")).toBeNull())
  })

  it("cancel dismisses the dialog and never exports", async () => {
    renderStats()

    fireEvent.click(screen.getByTestId("button-share-stats"))
    fireEvent.click(screen.getByTestId("button-share-cancel"))

    await waitFor(() => expect(screen.queryByTestId("dialog-share-preview")).toBeNull())
    expect(mockExportAndShare).not.toHaveBeenCalled()
  })

  it("keeps the dialog open when the export fails so the bettor can retry", async () => {
    mockExportAndShare.mockRejectedValueOnce(new Error("canvas exploded"))
    renderStats()

    fireEvent.click(screen.getByTestId("button-share-stats"))
    fireEvent.click(screen.getByTestId("button-share-confirm"))

    await waitFor(() => expect(mockExportAndShare).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId("dialog-share-preview")).toBeTruthy()
  })
})
