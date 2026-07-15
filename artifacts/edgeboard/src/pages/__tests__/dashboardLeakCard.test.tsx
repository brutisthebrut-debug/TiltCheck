// @vitest-environment jsdom
//
// The Dashboard's "Your Leak" card picks exactly one signal from the leak
// profile with a fixed priority — worst sport by net dollars, then the top
// repeated miss reason, then the overconfidence gap — and renders nothing at
// all when no signal qualifies. That selection is pure frontend logic; a
// regression would either shame a bettor with the wrong leak or silently hide
// the card. These tests pin the priority order, each variant's figure, the
// deep-link target, and the card's absence when the profile is empty.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { LeakProfile, StatsSummary, User } from "@workspace/api-client-react"
import Dashboard from "../Dashboard"

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUseGetLeakProfile = vi.fn()

vi.mock("@workspace/api-client-react", () => ({
  useGetStatsSummary: () => queryResult(statsWithData),
  useGetRecentActivity: () => queryResult([]),
  useGetBankroll: () => queryResult({ currentBalance: 500 }),
  useListBets: () => queryResult([]),
  useListParlays: () => queryResult([]),
  useGetNeedsSettling: () => queryResult({ count: 0, bets: [], parlays: [] }),
  useGetStreaks: () => queryResult(undefined),
  useGetUserBadges: () => queryResult([]),
  useGetLeakProfile: (...args: unknown[]) => mockUseGetLeakProfile(...args),
  getGetLeakProfileQueryKey: () => ["leak-profile"],
  getGetStreaksQueryKey: () => ["streaks"],
  getGetUserBadgesQueryKey: () => ["user-badges"],
  getGetStatsSummaryQueryKey: () => ["stats-summary"],
  getGetRecentActivityQueryKey: () => ["recent-activity"],
  getGetBankrollQueryKey: () => ["bankroll"],
  getListBetsQueryKey: () => ["bets"],
  getListParlaysQueryKey: () => ["parlays"],
  getGetNeedsSettlingQueryKey: () => ["needs-settling"],
}))

const activeUser = {
  id: 1,
  displayName: "Test Bettor",
  recapSeenWeek: null,
} as unknown as User

vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({ activeUser, allUsers: [], isLoading: false, needsClaim: false, refreshUser: () => {} }),
}))

// The recap teaser is orthogonal to these tests — keep it out of the tree so
// the leak card is the only conditional banner in play.
vi.mock("@/lib/recapTeaser", () => ({
  isRecapUnseen: () => false,
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Dashboard needs at least one counted bet or it renders the empty state
// (which never shows the leak card regardless of the profile).
const statsWithData = {
  wins: 5,
  losses: 3,
  pushes: 0,
  pending: 1,
  winRate: 62.5,
  roi: 4.2,
  totalProfit: 42,
  totalWagered: 1000,
  currentStreak: 2,
  currentStreakType: "win",
  longestWinStreak: 3,
} as unknown as StatsSummary

const worstSport = { sport: "NBA", netLoss: -230.5, bets: 12, recentNet: -80.25, recentBets: 4 }
const topMissReason = { reason: "emotional", count: 4, netLoss: 180, recentCount: 2, recentNetLoss: 90 }
const overconfidence = { winRate: 38.5, sample: 13, recentWinRate: 33.3, recentSample: 6 }

function makeProfile(overrides: Partial<LeakProfile> = {}): LeakProfile {
  return {
    settledCount: 20,
    recentWindowDays: 30,
    avgStake: 50,
    lastLossAt: "2026-07-10T00:00:00.000Z",
    worstSport: null,
    overconfidence: null,
    topMissReason: null,
    ...overrides,
  } as LeakProfile
}

function queryResult<T>(data: T | undefined) {
  return {
    data,
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

function setLeakProfile(profile: LeakProfile | undefined) {
  mockUseGetLeakProfile.mockReturnValue(queryResult(profile))
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ── Priority order ───────────────────────────────────────────────────────────

describe("Your Leak card priority", () => {
  it("worst sport wins when all three signals are present", () => {
    setLeakProfile(makeProfile({ worstSport, topMissReason, overconfidence }))
    renderDashboard()

    const link = screen.getByTestId("link-your-leak-worst-sport")
    expect(link).toBeTruthy()
    // Only one card, and it's the sport one — not the miss reason or the gap.
    expect(screen.queryByTestId("link-your-leak-miss-reason")).toBeNull()
    expect(screen.queryByTestId("link-your-leak-overconfidence")).toBeNull()

    const card = screen.getByTestId("card-your-leak")
    expect(card.textContent).toContain("NBA keeps cashing your checks")
    expect(card.textContent).toContain("12 settled NBA bets")
    // Net loss renders as-is (a negative dollar figure).
    expect(screen.getByTestId("text-leak-figure").textContent).toBe("-$230.50")
  })

  it("miss reason wins over overconfidence when there is no worst sport", () => {
    setLeakProfile(makeProfile({ topMissReason, overconfidence }))
    renderDashboard()

    const link = screen.getByTestId("link-your-leak-miss-reason")
    expect(link).toBeTruthy()
    expect(screen.queryByTestId("link-your-leak-worst-sport")).toBeNull()
    expect(screen.queryByTestId("link-your-leak-overconfidence")).toBeNull()

    const card = screen.getByTestId("card-your-leak")
    // The raw reason code is translated to its human label.
    expect(card.textContent).toContain('"Emotional bet" — again')
    expect(card.textContent).toContain("4 losses")
    // Miss-reason netLoss arrives positive; the card shows it as money lost
    // (whole-dollar amounts render without decimals).
    expect(screen.getByTestId("text-leak-figure").textContent).toBe("-$180")
  })

  it("overconfidence alone shows the win-rate figure", () => {
    setLeakProfile(makeProfile({ overconfidence }))
    renderDashboard()

    const link = screen.getByTestId("link-your-leak-overconfidence")
    expect(link).toBeTruthy()
    expect(screen.queryByTestId("link-your-leak-worst-sport")).toBeNull()
    expect(screen.queryByTestId("link-your-leak-miss-reason")).toBeNull()

    const card = screen.getByTestId("card-your-leak")
    expect(card.textContent).toContain("Your confidence is writing checks")
    expect(card.textContent).toContain("over 13 of them")
    expect(screen.getByTestId("text-leak-figure").textContent).toBe("38.5%")
  })
})

// ── Absence ──────────────────────────────────────────────────────────────────

describe("Your Leak card absence", () => {
  it("renders no card when the profile has no qualifying signal", () => {
    setLeakProfile(makeProfile())
    renderDashboard()

    expect(screen.queryByTestId("card-your-leak")).toBeNull()
    expect(screen.queryByTestId("link-your-leak-worst-sport")).toBeNull()
    expect(screen.queryByTestId("link-your-leak-miss-reason")).toBeNull()
    expect(screen.queryByTestId("link-your-leak-overconfidence")).toBeNull()
  })

  it("renders no card while the profile hasn't loaded", () => {
    setLeakProfile(undefined)
    renderDashboard()

    expect(screen.queryByTestId("card-your-leak")).toBeNull()
  })
})

// ── Trend line ───────────────────────────────────────────────────────────────
//
// The card's trend line compares the leak's recent-window damage against its
// all-time figure: red "still bleeding" when the habit continued recently,
// green "slowing down" when it didn't. Getting the direction wrong would tell
// a bettor the opposite of the truth, so both copy and glow class are pinned.

describe("Your Leak card trend", () => {
  const trendEl = () => screen.getByTestId("text-leak-trend")

  it("worst sport still losing recently reads still bleeding with the loss glow", () => {
    setLeakProfile(makeProfile({ worstSport }))
    renderDashboard()

    expect(trendEl().textContent).toBe("-$80.25 more over the last 30 days — still bleeding.")
    expect(trendEl().className).toContain("text-chart-2")
    expect(trendEl().className).toContain("text-glow-destructive")
  })

  it("worst sport up money recently reads slowing down with the win glow", () => {
    setLeakProfile(makeProfile({ worstSport: { ...worstSport, recentNet: 40, recentBets: 3 } }))
    renderDashboard()

    expect(trendEl().textContent).toBe("Up $40 on NBA over the last 30 days — slowing down.")
    expect(trendEl().className).toContain("text-chart-1")
    expect(trendEl().className).toContain("text-glow-success")
  })

  it("worst sport with no recent bets reads as gone quiet (improving)", () => {
    setLeakProfile(makeProfile({ worstSport: { ...worstSport, recentNet: 0, recentBets: 0 } }))
    renderDashboard()

    expect(trendEl().textContent).toBe("No NBA bets settled in the last 30 days — the leak's gone quiet.")
    expect(trendEl().className).toContain("text-chart-1")
  })

  it("miss reason repeated recently reads still bleeding", () => {
    setLeakProfile(makeProfile({ topMissReason }))
    renderDashboard()

    expect(trendEl().textContent).toBe("2 more (-$90) in the last 30 days — still bleeding.")
    expect(trendEl().className).toContain("text-chart-2")
  })

  it("miss reason with zero recent losses reads slowing down", () => {
    setLeakProfile(makeProfile({ topMissReason: { ...topMissReason, recentCount: 0, recentNetLoss: 0 } }))
    renderDashboard()

    expect(trendEl().textContent).toBe('Zero "emotional bet" losses in the last 30 days — slowing down.')
    expect(trendEl().className).toContain("text-chart-1")
  })

  it("overconfidence hitting worse recently reads still bleeding", () => {
    setLeakProfile(makeProfile({ overconfidence }))
    renderDashboard()

    expect(trendEl().textContent).toBe("33.3% over 6 in the last 30 days — still bleeding.")
    expect(trendEl().className).toContain("text-chart-2")
  })

  it("overconfidence hitting better recently reads slowing down", () => {
    setLeakProfile(makeProfile({ overconfidence: { ...overconfidence, recentWinRate: 50, recentSample: 4 } }))
    renderDashboard()

    expect(trendEl().textContent).toBe("Hitting 50% over the last 30 days — slowing down.")
    expect(trendEl().className).toContain("text-chart-1")
  })

  it("overconfidence with no recent high-confidence plays reads as gone quiet", () => {
    setLeakProfile(makeProfile({ overconfidence: { ...overconfidence, recentWinRate: null, recentSample: 0 } }))
    renderDashboard()

    expect(trendEl().textContent).toBe("No 7+ confidence plays settled in the last 30 days — the leak's gone quiet.")
    expect(trendEl().className).toContain("text-chart-1")
  })
})

// ── Deep links ───────────────────────────────────────────────────────────────

describe("Your Leak card deep links", () => {
  it("sport leak links to the pre-filtered bets list", () => {
    setLeakProfile(makeProfile({ worstSport }))
    renderDashboard()

    const link = screen.getByTestId("link-your-leak-worst-sport")
    expect(link.getAttribute("href")).toBe("/bets?mine=1&sport=NBA")
  })

  it("sport leak URL-encodes sports with spaces", () => {
    setLeakProfile(makeProfile({ worstSport: { ...worstSport, sport: "College Football" } }))
    renderDashboard()

    const link = screen.getByTestId("link-your-leak-worst-sport")
    expect(link.getAttribute("href")).toBe("/bets?mine=1&sport=College%20Football")
  })

  it("miss-reason leak links to the stats page", () => {
    setLeakProfile(makeProfile({ topMissReason }))
    renderDashboard()

    const link = screen.getByTestId("link-your-leak-miss-reason")
    expect(link.getAttribute("href")).toBe("/stats")
  })

  it("overconfidence leak links to the stats page", () => {
    setLeakProfile(makeProfile({ overconfidence }))
    renderDashboard()

    const link = screen.getByTestId("link-your-leak-overconfidence")
    expect(link.getAttribute("href")).toBe("/stats")
  })
})
