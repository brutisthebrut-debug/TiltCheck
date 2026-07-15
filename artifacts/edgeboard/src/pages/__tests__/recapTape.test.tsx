// @vitest-environment jsdom
//
// The Recap page's tape section has four mutually exclusive states picked by
// a chain of ternaries: loading skeleton, "No tape this week" empty card, the
// narrative card, and the daily-limit card. These tests pin each state to its
// test id with mocked recap + narrative responses, so a future edit to the
// ternary chain can't silently drop one (e.g. the empty card regressing to a
// blank gap — the exact bug the card was added to fix).

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { WeeklyRecap, WeeklyRecapPersonal, RecapNarrative, User } from "@workspace/api-client-react"
import Recap from "../Recap"

// ── Mocks ────────────────────────────────────────────────────────────────────
// The page pulls data through generated react-query hooks; we mock the hook
// module so each test controls exactly what the recap and narrative return.

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

function makeRecap(personal: Partial<WeeklyRecapPersonal> = {}): WeeklyRecap {
  return {
    weekStart: "2026-07-06",
    weekEnd: "2026-07-12",
    personal: makePersonal(personal),
    crew: { winner: null, biggestUpset: null, worstBeat: null },
  }
}

function queryResult<T>(data: T | undefined, opts: { isLoading?: boolean } = {}) {
  return {
    data,
    isLoading: opts.isLoading ?? false,
    isError: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

function setRecap(recap: WeeklyRecap | undefined, opts: { isLoading?: boolean } = {}) {
  mockUseGetWeeklyRecap.mockReturnValue(queryResult(recap, opts))
}

function setTape(tape: RecapNarrative | undefined, opts: { isLoading?: boolean } = {}) {
  mockUseGetRecapNarrative.mockReturnValue(queryResult(tape, opts))
}

function renderRecap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Recap />
    </QueryClientProvider>
  )
}

const TAPE_TEST_IDS = [
  "card-recap-tape-loading",
  "card-recap-tape-empty",
  "card-recap-tape",
  "card-recap-tape-limit",
] as const

/** Assert exactly one tape state renders — the ternary chain must never show two or zero. */
function expectOnlyTapeState(present: (typeof TAPE_TEST_IDS)[number] | null) {
  for (const id of TAPE_TEST_IDS) {
    if (id === present) {
      expect(screen.getByTestId(id)).toBeTruthy()
    } else {
      expect(screen.queryByTestId(id)).toBeNull()
    }
  }
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ── The four tape states ─────────────────────────────────────────────────────

describe("Recap tape section states", () => {
  it("shows the loading skeleton while the narrative is being fetched", () => {
    setRecap(makeRecap())
    setTape(undefined, { isLoading: true })
    renderRecap()

    expectOnlyTapeState("card-recap-tape-loading")
  })

  it("shows the 'No tape this week' empty card when narrative is null and nothing settled", () => {
    setRecap(makeRecap({ settledCount: 0, wins: 0, losses: 0, profit: 0, roi: 0 }))
    setTape({ weekStart: "2026-07-06", narrative: null } as RecapNarrative)
    renderRecap()

    expectOnlyTapeState("card-recap-tape-empty")
    expect(screen.getByText("No tape this week.")).toBeTruthy()
  })

  it("shows the narrative card when a narrative is present", () => {
    setRecap(makeRecap())
    setTape({ weekStart: "2026-07-06", narrative: "A sharp week.\n\nYou stayed disciplined." } as RecapNarrative)
    renderRecap()

    expectOnlyTapeState("card-recap-tape")
    expect(screen.getByText("A sharp week.")).toBeTruthy()
    expect(screen.getByText("You stayed disciplined.")).toBeTruthy()
  })

  it("shows the daily-limit card when generation hit today's budget", () => {
    setRecap(makeRecap())
    setTape({ weekStart: "2026-07-06", narrative: null, limitReached: true } as RecapNarrative)
    renderRecap()

    expectOnlyTapeState("card-recap-tape-limit")
  })
})

// ── Regression guards ────────────────────────────────────────────────────────

describe("Recap tape section edge weeks", () => {
  it("pending-only week (logged but nothing settled) shows the empty card, not a blank gap", () => {
    // The exact bug the empty card was added to fix: bets logged, none settled,
    // narrative null → without the empty card the section silently vanished.
    setRecap(makeRecap({ loggedCount: 4, settledCount: 0, wins: 0, losses: 0, profit: 0, roi: 0 }))
    setTape({ weekStart: "2026-07-06", narrative: null } as RecapNarrative)
    renderRecap()

    // The recap body renders (not the zero-activity empty state)…
    expect(screen.getByTestId("card-recap-record")).toBeTruthy()
    expect(screen.queryByTestId("card-recap-empty")).toBeNull()
    // …and exactly one tape state is present: the empty card. No blank gap.
    expectOnlyTapeState("card-recap-tape-empty")
  })

  it("zero-activity week shows the quiet-week card and no tape card at all", () => {
    setRecap(makeRecap({ loggedCount: 0, settledCount: 0, wins: 0, losses: 0, profit: 0, roi: 0 }))
    setTape({ weekStart: "2026-07-06", narrative: null } as RecapNarrative)
    renderRecap()

    expect(screen.getByTestId("card-recap-empty")).toBeTruthy()
    expectOnlyTapeState(null)
  })
})
