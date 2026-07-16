// @vitest-environment jsdom
//
// Deleting a play is destructive AND (for settled plays) moves money. The
// warning contract (#21): before anything is removed, the confirm dialog
// tells the bettor exactly what the deletion does to their balance —
// pending = nothing, settled = a correction entry of the opposite sign.
// These tests pin the contract so the dialog can't silently lose the number.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import BetDetail from "../BetDetail"
import ParlayDetail from "../ParlayDetail"

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockDeleteBetMutate = vi.fn()
const mockDeleteParlayMutate = vi.fn()

let betData: Record<string, unknown> | undefined
let parlayData: Record<string, unknown> | undefined

vi.mock("wouter", () => ({
  useParams: () => ({ id: "7" }),
  useLocation: () => ["/bets/7", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock("@workspace/api-client-react", () => ({
  useGetBet: () => ({ data: betData, isLoading: false, isError: false, refetch: vi.fn(), isRefetching: false }),
  useGetParlay: () => ({ data: parlayData, isLoading: false, isError: false, refetch: vi.fn(), isRefetching: false }),
  useSettleBet: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useSettleParlay: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useUnsettleBet: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useUnsettleParlay: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useUpdateBet: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useUpdateParlayLeg: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useRecomputeParlayOdds: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  useDeleteBet: () => ({ mutate: mockDeleteBetMutate, isPending: false, isError: false, error: null }),
  useDeleteParlay: () => ({ mutate: mockDeleteParlayMutate, isPending: false, isError: false, error: null }),
  getListBetsQueryKey: () => ["bets"],
  getListParlaysQueryKey: () => ["parlays"],
  getGetBetQueryKey: (id: number) => ["bet", id],
  getGetParlayQueryKey: (id: number) => ["parlay", id],
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

function makeBet(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    userId: 1,
    userName: "Test Bettor",
    sport: "NFL",
    event: "Chiefs @ Bills",
    betType: "moneyline",
    pick: "Chiefs ML",
    odds: -110,
    stake: 100,
    potentialPayout: 190.91,
    actualPayout: null,
    gameDate: "2026-07-10",
    confidenceScore: 5,
    status: "pending",
    rationale: null,
    reasoningQuality: null,
    whatHappened: null,
    missReason: null,
    sportsbook: null,
    promoNote: null,
    createdAt: "2026-07-09T12:00:00Z",
    ...over,
  }
}

function makeParlay(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    userId: 1,
    userName: "Test Bettor",
    name: "Sunday Special",
    stake: 25,
    odds: 264,
    potentialPayout: 91,
    actualPayout: null,
    confidenceScore: 5,
    status: "pending",
    rationale: null,
    reasoningQuality: null,
    whatHappened: null,
    missReason: null,
    sportsbook: null,
    promoNote: null,
    createdAt: "2026-07-09T12:00:00Z",
    legs: [
      { id: 1, sport: "NBA", event: "Lakers @ Celtics", betType: "spread", pick: "Lakers +4.5", odds: -110, gameDate: "2026-07-10", status: "pending" },
      { id: 2, sport: "NFL", event: "Chiefs @ Bills", betType: "moneyline", pick: "Chiefs ML", odds: -120, gameDate: "2026-07-10", status: "pending" },
    ],
    ...over,
  }
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
  betData = undefined
  parlayData = undefined
})

// ── BetDetail ────────────────────────────────────────────────────────────────

describe("BetDetail delete warning", () => {
  it("settled won bet: dialog states the original impact and the reversal amount", async () => {
    betData = makeBet({ status: "won", actualPayout: 190.91 })
    renderPage(BetDetail)

    fireEvent.click(screen.getByTestId("button-delete-bet"))
    await waitFor(() => expect(screen.getByTestId("text-delete-impact")).toBeTruthy())

    const impact = screen.getByTestId("text-delete-impact").textContent!
    // moved by +$90.91, so the balance will change by −$90.91
    expect(impact).toContain("+$90.91")
    expect(impact).toContain("−$90.91")
    expect(impact).toContain("correction entry")
    expect(impact).toContain("can't be undone")
  })

  it("settled lost bet: reversal gives the stake back (+)", async () => {
    betData = makeBet({ status: "lost", actualPayout: 0 })
    renderPage(BetDetail)

    fireEvent.click(screen.getByTestId("button-delete-bet"))
    const impact = (await screen.findByTestId("text-delete-impact")).textContent!
    expect(impact).toContain("−$100") // it moved the bankroll down by the stake
    expect(impact).toContain("+$100") // deleting gives it back
  })

  it("pending bet: dialog says the balance doesn't change", async () => {
    betData = makeBet()
    renderPage(BetDetail)

    fireEvent.click(screen.getByTestId("button-delete-bet"))
    const impact = (await screen.findByTestId("text-delete-impact")).textContent!
    expect(impact).toContain("balance doesn't change")
    expect(impact).not.toContain("correction entry")
  })

  it("push: dialog says the wash won't change the balance", async () => {
    betData = makeBet({ status: "push", actualPayout: 100 })
    renderPage(BetDetail)

    fireEvent.click(screen.getByTestId("button-delete-bet"))
    const impact = (await screen.findByTestId("text-delete-impact")).textContent!
    expect(impact).toContain("won't change")
  })

  it("confirming actually fires the delete; nothing fires before that", async () => {
    betData = makeBet({ status: "won", actualPayout: 190.91 })
    renderPage(BetDetail)

    fireEvent.click(screen.getByTestId("button-delete-bet"))
    expect(mockDeleteBetMutate).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByTestId("button-confirm-delete-bet"))
    await waitFor(() => expect(mockDeleteBetMutate).toHaveBeenCalledTimes(1))
    expect(mockDeleteBetMutate.mock.calls[0][0]).toEqual({ id: 7 })
  })

  it("another bettor's play has no delete button at all", () => {
    betData = makeBet({ userId: 2, userName: "Someone Else" })
    renderPage(BetDetail)
    expect(screen.queryByTestId("button-delete-bet")).toBeNull()
  })
})

// ── ParlayDetail ─────────────────────────────────────────────────────────────

describe("ParlayDetail delete warning", () => {
  it("settled won parlay: dialog states the reversal amount", async () => {
    parlayData = makeParlay({ status: "won", actualPayout: 91 })
    renderPage(ParlayDetail)

    fireEvent.click(screen.getByTestId("button-delete-parlay"))
    const impact = (await screen.findByTestId("text-delete-impact")).textContent!
    expect(impact).toContain("+$66")
    expect(impact).toContain("−$66")
    expect(impact).toContain("correction entry")
  })

  it("pending parlay: dialog says the balance doesn't change, confirm fires delete", async () => {
    parlayData = makeParlay()
    renderPage(ParlayDetail)

    fireEvent.click(screen.getByTestId("button-delete-parlay"))
    const impact = (await screen.findByTestId("text-delete-impact")).textContent!
    expect(impact).toContain("balance doesn't change")

    fireEvent.click(screen.getByTestId("button-confirm-delete-parlay"))
    await waitFor(() => expect(mockDeleteParlayMutate).toHaveBeenCalledTimes(1))
    expect(mockDeleteParlayMutate.mock.calls[0][0]).toEqual({ id: 7 })
  })

  it("another bettor's parlay has no delete button", () => {
    parlayData = makeParlay({ userId: 2 })
    renderPage(ParlayDetail)
    expect(screen.queryByTestId("button-delete-parlay")).toBeNull()
  })
})
