// @vitest-environment jsdom
//
// The Recap page's highlight cards (best call, worst beat, leak) and the crew
// section are all conditionally rendered: each card only appears when its data
// is present, and the crew section flips between an empty card and up to three
// highlight cards. Nothing else on the page fails if one of these silently
// stops rendering, so these tests pin each card to its test id with mocked
// recap responses — presence when the data exists, absence when it's null.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { WeeklyRecap, WeeklyRecapPersonal, RecapNarrative, User } from "@workspace/api-client-react"
import Recap from "../Recap"

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUseGetWeeklyRecap = vi.fn()
const mockUseGetRecapNarrative = vi.fn()

vi.mock("@workspace/api-client-react", () => ({
  useGetWeeklyRecap: (...args: unknown[]) => mockUseGetWeeklyRecap(...args),
  useGetRecapNarrative: (...args: unknown[]) => mockUseGetRecapNarrative(...args),
  useMarkRecapSeen: () => ({ mutate: vi.fn() }),
  getGetWeeklyRecapQueryKey: () => ["weekly-recap"],
  getGetRecapNarrativeQueryKey: () => ["recap-narrative"],
  getGetCurrentUserQueryKey: () => ["current-user"],
}))

const activeUser = {
  id: 1,
  name: "Test Bettor",
  // Marked as already seen for every possible week so the page never fires
  // the mark-seen mutation during these render-only tests.
  recapSeenWeek: "9999-12-27",
} as unknown as User

vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({ activeUser, allUsers: [], isLoading: false, needsClaim: false, refreshUser: () => {} }),
}))

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePersonal(overrides: Partial<WeeklyRecapPersonal> = {}): WeeklyRecapPersonal {
  return {
    userId: 1,
    loggedCount: 3,
    settledCount: 2,
    wins: 1,
    losses: 1,
    pushes: 0,
    profit: 12.5,
    totalWagered: 100,
    roi: 12.5,
    bestWin: null,
    worstBeat: null,
    leak: null,
    ...overrides,
  }
}

function makeRecap(
  personal: Partial<WeeklyRecapPersonal> = {},
  crew: Partial<WeeklyRecap["crew"]> = {}
): WeeklyRecap {
  return {
    weekStart: "2026-07-06",
    weekEnd: "2026-07-12",
    personal: makePersonal(personal),
    crew: { winner: null, biggestUpset: null, worstBeat: null, ...crew },
  }
}

const bestWin = { title: "Chiefs -3", amount: 150, odds: -110 } as NonNullable<WeeklyRecapPersonal["bestWin"]>
const worstBeat = { title: "Lakers ML", amount: -200, odds: 120 } as NonNullable<WeeklyRecapPersonal["worstBeat"]>

function makeLeak(kind: string, label: string): NonNullable<WeeklyRecapPersonal["leak"]> {
  return { kind, label, amount: -85, count: 3 } as NonNullable<WeeklyRecapPersonal["leak"]>
}

const crewWinner = { userId: 2, userName: "Dana", wins: 4, losses: 1, profit: 220 } as NonNullable<WeeklyRecap["crew"]["winner"]>
const crewUpset = { userId: 3, userName: "Marco", title: "12-leg parlay", odds: 900, amount: 450 } as NonNullable<WeeklyRecap["crew"]["biggestUpset"]>
const crewBeat = { userId: 4, userName: "Sam", title: "Jets +7", amount: -300 } as NonNullable<WeeklyRecap["crew"]["worstBeat"]>

function queryResult<T>(data: T | undefined, opts: { isLoading?: boolean } = {}) {
  return {
    data,
    isLoading: opts.isLoading ?? false,
    isError: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

function setRecap(recap: WeeklyRecap | undefined) {
  mockUseGetWeeklyRecap.mockReturnValue(queryResult(recap))
}

function renderRecap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Recap />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  // The tape section is orthogonal to these tests; keep it in its quiet
  // "no narrative, nothing to show" state throughout.
  mockUseGetRecapNarrative.mockReturnValue(
    queryResult({ weekStart: "2026-07-06", narrative: null } as RecapNarrative)
  )
})

// ── Personal highlight cards ─────────────────────────────────────────────────

describe("Recap personal highlight cards", () => {
  it("renders no highlight cards when bestWin, worstBeat, and leak are all null", () => {
    setRecap(makeRecap())
    renderRecap()

    expect(screen.getByTestId("card-recap-record")).toBeTruthy()
    expect(screen.queryByTestId("card-recap-best-win")).toBeNull()
    expect(screen.queryByTestId("card-recap-worst-beat")).toBeNull()
    expect(screen.queryByTestId("card-recap-leak")).toBeNull()
  })

  it("renders the best-win card when bestWin is present", () => {
    setRecap(makeRecap({ bestWin }))
    renderRecap()

    const card = screen.getByTestId("card-recap-best-win")
    expect(card.textContent).toContain("Chiefs -3")
    expect(screen.queryByTestId("card-recap-worst-beat")).toBeNull()
    expect(screen.queryByTestId("card-recap-leak")).toBeNull()
  })

  it("renders the worst-beat card when worstBeat is present", () => {
    setRecap(makeRecap({ worstBeat }))
    renderRecap()

    const card = screen.getByTestId("card-recap-worst-beat")
    expect(card.textContent).toContain("Lakers ML")
    expect(screen.queryByTestId("card-recap-best-win")).toBeNull()
    expect(screen.queryByTestId("card-recap-leak")).toBeNull()
  })

  it("renders all three highlight cards together when all data is present", () => {
    setRecap(makeRecap({ bestWin, worstBeat, leak: makeLeak("parlays", "parlays") }))
    renderRecap()

    expect(screen.getByTestId("card-recap-best-win")).toBeTruthy()
    expect(screen.getByTestId("card-recap-worst-beat")).toBeTruthy()
    expect(screen.getByTestId("card-recap-leak")).toBeTruthy()
  })
})

// ── Leak card headline per kind ──────────────────────────────────────────────

describe("Recap leak card headlines", () => {
  it("sport leak names the sport in the headline", () => {
    setRecap(makeRecap({ leak: makeLeak("sport", "NBA") }))
    renderRecap()

    const card = screen.getByTestId("card-recap-leak")
    expect(card.textContent).toContain("You lose money on NBA.")
  })

  it("parlays leak uses the parlay headline", () => {
    setRecap(makeRecap({ leak: makeLeak("parlays", "parlays") }))
    renderRecap()

    const card = screen.getByTestId("card-recap-leak")
    expect(card.textContent).toContain("Parlays are not your friend.")
  })

  it("miss_reason leak translates a known reason into its phrase", () => {
    setRecap(makeRecap({ leak: makeLeak("miss_reason", "emotional") }))
    renderRecap()

    const card = screen.getByTestId("card-recap-leak")
    expect(card.textContent).toContain("Your money is leaking to emotional bets.")
  })

  it("miss_reason leak falls back to the raw label when the reason is unknown", () => {
    setRecap(makeRecap({ leak: makeLeak("miss_reason", "mystery_reason") }))
    renderRecap()

    const card = screen.getByTestId("card-recap-leak")
    expect(card.textContent).toContain("Your money is leaking to mystery_reason.")
  })
})

// ── Crew section ─────────────────────────────────────────────────────────────

describe("Recap crew section", () => {
  it("shows the empty crew card when all crew highlights are null", () => {
    setRecap(makeRecap())
    renderRecap()

    expect(screen.getByTestId("card-recap-crew-empty")).toBeTruthy()
    expect(screen.queryByTestId("card-recap-crew-winner")).toBeNull()
    expect(screen.queryByTestId("card-recap-crew-upset")).toBeNull()
    expect(screen.queryByTestId("card-recap-crew-beat")).toBeNull()
  })

  it("shows only the winner card when just the winner is present", () => {
    setRecap(makeRecap({}, { winner: crewWinner }))
    renderRecap()

    expect(screen.queryByTestId("card-recap-crew-empty")).toBeNull()
    const card = screen.getByTestId("card-recap-crew-winner")
    expect(card.textContent).toContain("Dana won the week")
    expect(card.textContent).not.toContain("(that's you)")
    expect(screen.queryByTestId("card-recap-crew-upset")).toBeNull()
    expect(screen.queryByTestId("card-recap-crew-beat")).toBeNull()
  })

  it("tags the winner with \"(that's you)\" when the winner is the active user", () => {
    setRecap(makeRecap({}, { winner: { ...crewWinner, userId: 1, userName: "Test Bettor" } }))
    renderRecap()

    const card = screen.getByTestId("card-recap-crew-winner")
    expect(card.textContent).toContain("Test Bettor won the week (that's you)")
  })

  it("shows all three crew cards when winner, upset, and beat are all present", () => {
    setRecap(makeRecap({}, { winner: crewWinner, biggestUpset: crewUpset, worstBeat: crewBeat }))
    renderRecap()

    expect(screen.queryByTestId("card-recap-crew-empty")).toBeNull()
    expect(screen.getByTestId("card-recap-crew-winner")).toBeTruthy()
    const upset = screen.getByTestId("card-recap-crew-upset")
    expect(upset.textContent).toContain("Marco hit")
    const beat = screen.getByTestId("card-recap-crew-beat")
    expect(beat.textContent).toContain("Sam took the week's worst beat")
  })
})
