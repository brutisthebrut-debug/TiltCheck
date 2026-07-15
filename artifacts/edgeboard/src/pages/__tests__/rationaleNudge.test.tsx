// @vitest-environment jsdom
//
// The bet and parlay forms nudge — but never block — a bettor who submits
// without writing a rationale. First submit with an empty "why" shows the
// nudge and does NOT create the play; the second submit ("Log It Anyway")
// goes through. Writing a rationale skips the nudge entirely. These tests pin
// that soft-gate behavior so the nudge can't silently become a hard block or
// disappear.

import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import NewBet from "../NewBet"
import NewParlay from "../NewParlay"

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockCreateBetMutate = vi.fn()
const mockCreateParlayMutate = vi.fn()

vi.mock("@workspace/api-client-react", () => ({
  useCreateBet: () => ({ mutate: mockCreateBetMutate, isPending: false, isError: false, error: null }),
  useCreateParlay: () => ({ mutate: mockCreateParlayMutate, isPending: false, isError: false, error: null }),
  useGetLeakProfile: () => ({ data: undefined }),
  getGetLeakProfileQueryKey: () => ["leak-profile"],
  getListBetsQueryKey: () => ["bets"],
  getListParlaysQueryKey: () => ["parlays"],
  getGetStatsSummaryQueryKey: () => ["stats-summary"],
  getGetStatsInsightsQueryKey: () => ["stats-insights"],
  useGetStatsInsights: () => ({ data: undefined, isLoading: false }),
  getGetRecentActivityQueryKey: () => ["recent-activity"],
  getGetBankrollQueryKey: () => ["bankroll"],
  getGetNeedsSettlingQueryKey: () => ["needs-settling"],
  getGetUserBadgesQueryKey: () => ["user-badges"],
  getGetStreaksQueryKey: () => ["streaks"],
  // Pulled in transitively via useOddsFormat
  useUpdateUser: () => ({ mutate: vi.fn(), isPending: false }),
  getGetCurrentUserQueryKey: () => ["current-user"],
  // Pulled in transitively via MistakeWarning
  useGetStatsInsights: () => ({ data: undefined }),
  getGetStatsInsightsQueryKey: () => ["stats-insights"],
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

vi.mock("@/hooks/use-pro", () => ({
  useProStatus: () => ({ isPro: false, isLoading: false }),
}))

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
  localStorage.clear()
  // Pre-seed a favorite sport so the bet form's Sport select (radix, painful
  // to drive in jsdom) starts valid and submits reach onSubmit.
  localStorage.setItem("edgeboard-favorite-sports", JSON.stringify(["NFL"]))
})

// ── NewBet ───────────────────────────────────────────────────────────────────

describe("NewBet rationale nudge", () => {
  it("first submit without a rationale shows the nudge and does not log the bet", async () => {
    renderPage(NewBet)

    fireEvent.change(screen.getByLabelText(/event/i), { target: { value: "Chiefs vs Bills" } })
    fireEvent.change(screen.getByLabelText(/pick/i), { target: { value: "Chiefs -3" } })

    fireEvent.click(screen.getByTestId("button-submit-bet"))

    await waitFor(() => {
      expect(screen.getByTestId("nudge-rationale")).toBeTruthy()
    })
    expect(mockCreateBetMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId("button-submit-bet").textContent).toContain("Log It Anyway")
  })

  it("second submit after the nudge logs the bet anyway", async () => {
    renderPage(NewBet)

    fireEvent.change(screen.getByLabelText(/event/i), { target: { value: "Chiefs vs Bills" } })
    fireEvent.change(screen.getByLabelText(/pick/i), { target: { value: "Chiefs -3" } })

    fireEvent.click(screen.getByTestId("button-submit-bet"))
    await waitFor(() => expect(screen.getByTestId("nudge-rationale")).toBeTruthy())

    fireEvent.click(screen.getByTestId("button-submit-bet"))
    await waitFor(() => expect(mockCreateBetMutate).toHaveBeenCalledTimes(1))
  })

  it("submitting with a rationale skips the nudge and logs immediately", async () => {
    renderPage(NewBet)

    fireEvent.change(screen.getByLabelText(/event/i), { target: { value: "Chiefs vs Bills" } })
    fireEvent.change(screen.getByLabelText(/pick/i), { target: { value: "Chiefs -3" } })
    fireEvent.change(screen.getByTestId("input-rationale"), { target: { value: "Line moved my way all week" } })

    fireEvent.click(screen.getByTestId("button-submit-bet"))

    await waitFor(() => expect(mockCreateBetMutate).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId("nudge-rationale")).toBeNull()
    expect(mockCreateBetMutate.mock.calls[0][0].data.rationale).toBe("Line moved my way all week")
  })

  it("typing a rationale after the nudge hides it and restores the normal button", async () => {
    renderPage(NewBet)

    fireEvent.change(screen.getByLabelText(/event/i), { target: { value: "Chiefs vs Bills" } })
    fireEvent.change(screen.getByLabelText(/pick/i), { target: { value: "Chiefs -3" } })
    fireEvent.click(screen.getByTestId("button-submit-bet"))
    await waitFor(() => expect(screen.getByTestId("nudge-rationale")).toBeTruthy())

    fireEvent.change(screen.getByTestId("input-rationale"), { target: { value: "Actually, here's the edge" } })

    await waitFor(() => expect(screen.queryByTestId("nudge-rationale")).toBeNull())
    expect(screen.getByTestId("button-submit-bet").textContent).toContain("Log Bet")
  })
})

// ── NewParlay ────────────────────────────────────────────────────────────────

describe("NewParlay rationale nudge", () => {
  function fillParlayLegs() {
    // Name + both legs' event and pick are the required free-text fields;
    // sport, bet type, odds, and game date all default valid.
    fireEvent.change(screen.getByPlaceholderText("e.g. Sunday NFL Slate"), { target: { value: "Sunday Slate" } })
    const eventInputs = screen.getAllByPlaceholderText("e.g. Chiefs @ Raiders")
    const pickInputs = screen.getAllByPlaceholderText("Chiefs -3.5")
    fireEvent.change(eventInputs[0], { target: { value: "Chiefs @ Raiders" } })
    fireEvent.change(eventInputs[1], { target: { value: "Bills @ Jets" } })
    fireEvent.change(pickInputs[0], { target: { value: "Chiefs -3" } })
    fireEvent.change(pickInputs[1], { target: { value: "Over 47.5" } })
  }

  it("first submit without a rationale shows the nudge and does not log the parlay", async () => {
    renderPage(NewParlay)
    fillParlayLegs()

    fireEvent.click(screen.getByTestId("button-submit-parlay"))

    await waitFor(() => expect(screen.getByTestId("nudge-rationale")).toBeTruthy())
    expect(mockCreateParlayMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId("button-submit-parlay").textContent).toContain("Log It Anyway")
  })

  it("second submit after the nudge logs the parlay anyway", async () => {
    renderPage(NewParlay)
    fillParlayLegs()

    fireEvent.click(screen.getByTestId("button-submit-parlay"))
    await waitFor(() => expect(screen.getByTestId("nudge-rationale")).toBeTruthy())

    fireEvent.click(screen.getByTestId("button-submit-parlay"))
    await waitFor(() => expect(mockCreateParlayMutate).toHaveBeenCalledTimes(1))
  })

  it("submitting with a rationale skips the nudge entirely", async () => {
    renderPage(NewParlay)
    fillParlayLegs()
    fireEvent.change(screen.getByTestId("input-rationale"), { target: { value: "Correlated: script favors both" } })

    fireEvent.click(screen.getByTestId("button-submit-parlay"))

    await waitFor(() => expect(mockCreateParlayMutate).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId("nudge-rationale")).toBeNull()
  })
})
