// @vitest-environment jsdom
//
// Tilt spiral card — render verification.
//
// Confirms that the tilt-check card mounts when leakProfile.tiltSpiral is
// truthy, shows the key copy, and is absent when the signal is null or the
// profile hasn't loaded. Also verifies the historical cost line renders when
// tiltEventCount > 1 and tiltCostDollars is non-null.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { LeakProfile, StatsSummary, User } from "@workspace/api-client-react"
import Dashboard from "../Dashboard"

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUseGetLeakProfile = vi.fn()
const mockMarkLeakCelebrationSeen = vi.fn()

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
  useGetBillingStatus: () => queryResult({ isPro: true, proUntil: null, source: "subscription" }),
  getGetBillingStatusQueryKey: () => ["billing-status"],
  useMarkLeakCelebrationSeen: () => ({ mutate: mockMarkLeakCelebrationSeen }),
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
  displayName: "Tester",
  recapSeenWeek: null,
} as unknown as User

vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({ activeUser, allUsers: [], isLoading: false, needsClaim: false, refreshUser: () => {} }),
}))

vi.mock("@/lib/recapTeaser", () => ({
  isRecapUnseen: () => false,
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

function queryResult<T>(data: T | undefined) {
  return {
    data,
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

function makeProfile(overrides: Partial<LeakProfile> = {}): LeakProfile {
  return {
    settledCount: 15,
    recentWindowDays: 30,
    avgStake: 50,
    lastLossAt: "2026-07-14T00:00:00.000Z",
    worstSport: null,
    overconfidence: null,
    topMissReason: null,
    tiltSpiral: null,
    trendFlip: false,
    roiBand: null,
    ...overrides,
  } as LeakProfile
}

const activeTilt = {
  windowHours: 12,
  recentLosses: 3,
  rapidPlays: 5,
  burstAvgStake: 85,
  stakeRatio: 1.7,
  tiltCostDollars: 340,
  tiltEventCount: 3,
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
  // Default: no profile loaded so each test opts in explicitly.
  mockUseGetLeakProfile.mockReturnValue(queryResult(undefined))
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Tilt spiral card", () => {
  it("renders the tilt card when tiltSpiral is truthy", () => {
    setLeakProfile(makeProfile({ tiltSpiral: activeTilt }))
    renderDashboard()

    const card = screen.getByTestId("card-tilt-spiral")
    expect(card).toBeTruthy()
  })

  it("shows loss count, window hours, play count and stake ratio", () => {
    setLeakProfile(makeProfile({ tiltSpiral: activeTilt }))
    renderDashboard()

    const card = screen.getByTestId("card-tilt-spiral")
    expect(card.textContent).toContain("3 Ls in the last 12 hours")
    expect(card.textContent).toContain("5 quick plays")
    expect(card.textContent).toContain("1.7x your usual")
  })

  it("shows historical cost line when tiltEventCount > 1 and tiltCostDollars is set", () => {
    setLeakProfile(makeProfile({ tiltSpiral: activeTilt }))
    renderDashboard()

    const card = screen.getByTestId("card-tilt-spiral")
    expect(card.textContent).toContain("Your last 3 tilt nights cost you")
    expect(card.textContent).toContain("$340")
  })

  it("suppresses the historical cost line when tiltEventCount is 1", () => {
    setLeakProfile(makeProfile({ tiltSpiral: { ...activeTilt, tiltEventCount: 1 } }))
    renderDashboard()

    const card = screen.getByTestId("card-tilt-spiral")
    expect(card.textContent).not.toContain("tilt nights cost you")
  })

  it("suppresses the historical cost line when tiltCostDollars is null", () => {
    setLeakProfile(makeProfile({ tiltSpiral: { ...activeTilt, tiltCostDollars: null } }))
    renderDashboard()

    const card = screen.getByTestId("card-tilt-spiral")
    expect(card.textContent).not.toContain("tilt nights cost you")
  })

  it("is absent when leakProfile is not yet loaded", () => {
    setLeakProfile(undefined)
    renderDashboard()

    expect(screen.queryByTestId("card-tilt-spiral")).toBeNull()
  })

  it("is absent when tiltSpiral is null", () => {
    setLeakProfile(makeProfile({ tiltSpiral: null }))
    renderDashboard()

    expect(screen.queryByTestId("card-tilt-spiral")).toBeNull()
  })
})
