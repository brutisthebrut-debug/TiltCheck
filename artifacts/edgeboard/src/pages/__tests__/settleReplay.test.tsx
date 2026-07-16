// @vitest-environment jsdom
//
// The post-result review dialog replays what the bettor said going in — the
// original rationale and confidence — so the reasoning grade is about the
// call actually made, not the call remembered. These tests pin the replay
// block (with rationale, and with the honest "nothing written" fallback) and
// the always-visible "The Why" section on the detail page.

import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import BetDetail from "../BetDetail"
import ParlayDetail from "../ParlayDetail"

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUseGetBet = vi.fn()
const mockUseGetParlay = vi.fn()

vi.mock("@workspace/api-client-react", () => ({
  useGetBet: (...args: unknown[]) => mockUseGetBet(...args),
  useGetParlay: (...args: unknown[]) => mockUseGetParlay(...args),
  useSettleBet: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useSettleParlay: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useUnsettleBet: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteBet: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useDeleteParlay: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useUnsettleParlay: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateParlayLeg: () => ({ mutate: vi.fn(), isPending: false }),
  useRecomputeParlayOdds: () => ({ mutate: vi.fn(), isPending: false }),
  getGetBetQueryKey: () => ["bet"],
  getGetParlayQueryKey: () => ["parlay"],
  getListBetsQueryKey: () => ["bets"],
  getListParlaysQueryKey: () => ["parlays"],
  getGetStatsSummaryQueryKey: () => ["stats-summary"],
  getGetBankrollQueryKey: () => ["bankroll"],
  getGetRecentActivityQueryKey: () => ["recent-activity"],
  getGetNeedsSettlingQueryKey: () => ["needs-settling"],
  getGetUserBadgesQueryKey: () => ["user-badges"],
  getGetStreaksQueryKey: () => ["streaks"],
  // Pulled in transitively via useOddsFormat
  useUpdateUser: () => ({ mutate: vi.fn(), isPending: false }),
  getGetCurrentUserQueryKey: () => ["current-user"],
}))

vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({
    activeUser: { id: 1, name: "Test Bettor" },
    allUsers: [],
    isLoading: false,
    needsClaim: false,
    refreshUser: () => {},
  }),
}))

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>()
  return {
    ...actual,
    useParams: () => ({ id: "1" }),
    useLocation: () => ["/bets/1", vi.fn()],
  }
})

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeBet(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    sport: "NFL",
    event: "Chiefs vs Bills",
    betType: "spread",
    pick: "Chiefs -3",
    odds: -110,
    stake: 100,
    potentialPayout: 190.91,
    gameDate: "2026-07-14",
    confidenceScore: 7,
    rationale: null,
    promoNote: null,
    sportsbook: null,
    status: "pending",
    actualPayout: null,
    settledAt: null,
    reasoningQuality: null,
    whatHappened: null,
    missReason: null,
    createdAt: "2026-07-14T00:00:00Z",
    ...overrides,
  }
}

function makeParlay(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "Sunday Slate",
    odds: 264,
    stake: 50,
    potentialPayout: 182,
    confidenceScore: 4,
    rationale: null,
    promoNote: null,
    sportsbook: null,
    status: "pending",
    actualPayout: null,
    settledAt: null,
    reasoningQuality: null,
    whatHappened: null,
    missReason: null,
    createdAt: "2026-07-14T00:00:00Z",
    legs: [
      { id: 1, sport: "NFL", event: "Chiefs @ Raiders", betType: "spread", pick: "Chiefs -3", odds: -110, gameDate: "2026-07-14", status: "pending" },
      { id: 2, sport: "NFL", event: "Bills @ Jets", betType: "total", pick: "Over 47.5", odds: -110, gameDate: "2026-07-14", status: "pending" },
    ],
    ...overrides,
  }
}

function queryResult<T>(data: T) {
  return { data, isLoading: false, isError: false, isRefetching: false, refetch: vi.fn() }
}

function renderPage(Page: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ── BetDetail ────────────────────────────────────────────────────────────────

describe("BetDetail rationale surfacing", () => {
  it("shows the rationale in The Why section when present", () => {
    mockUseGetBet.mockReturnValue(queryResult(makeBet({ rationale: "Line moved my way all week" })))
    renderPage(BetDetail)

    const section = screen.getByTestId("section-rationale")
    expect(section.textContent).toContain("Line moved my way all week")
    expect(screen.queryByTestId("text-no-rationale")).toBeNull()
  })

  it("shows an honest empty state in The Why section when no rationale was written", () => {
    mockUseGetBet.mockReturnValue(queryResult(makeBet()))
    renderPage(BetDetail)

    expect(screen.getByTestId("text-no-rationale")).toBeTruthy()
  })

  it("replays the rationale and confidence in the settle dialog", () => {
    mockUseGetBet.mockReturnValue(queryResult(makeBet({ rationale: "Fade the public here" })))
    renderPage(BetDetail)

    fireEvent.click(screen.getByRole("button", { name: /won/i }))

    const replay = screen.getByTestId("replay-rationale")
    expect(replay.textContent).toContain("What you said going in")
    expect(replay.textContent).toContain("Fade the public here")
    expect(replay.textContent).toContain("7/10")
  })

  it("replays an honest 'nothing written' line when the bet had no rationale", () => {
    mockUseGetBet.mockReturnValue(queryResult(makeBet()))
    renderPage(BetDetail)

    fireEvent.click(screen.getByRole("button", { name: /lost/i }))

    const replay = screen.getByTestId("replay-rationale")
    expect(replay.textContent).toContain("No rationale was written")
  })
})

// ── ParlayDetail ─────────────────────────────────────────────────────────────

describe("ParlayDetail rationale surfacing", () => {
  it("shows The Why section with the rationale when present", () => {
    mockUseGetParlay.mockReturnValue(queryResult(makeParlay({ rationale: "Correlated legs, same script" })))
    renderPage(ParlayDetail)

    const section = screen.getByTestId("section-rationale")
    expect(section.textContent).toContain("Correlated legs, same script")
  })

  it("shows the honest empty state when no rationale was written", () => {
    mockUseGetParlay.mockReturnValue(queryResult(makeParlay()))
    renderPage(ParlayDetail)

    expect(screen.getByTestId("text-no-rationale")).toBeTruthy()
  })

  it("replays the rationale and confidence in the settle dialog", () => {
    mockUseGetParlay.mockReturnValue(queryResult(makeParlay({ rationale: "Correlated legs, same script" })))
    renderPage(ParlayDetail)

    fireEvent.click(screen.getByRole("button", { name: /won/i }))

    const replay = screen.getByTestId("replay-rationale")
    expect(replay.textContent).toContain("What you said going in")
    expect(replay.textContent).toContain("Correlated legs, same script")
    expect(replay.textContent).toContain("4/10")
  })
})
