// @vitest-environment jsdom
//
// The bet and parlay forms must block out-of-range odds BEFORE they hit the
// server: American odds with magnitude below 100 (the -99..+99 "dead zone",
// including 0) are not real prices, and submitting one should show an inline
// error instead of firing the create mutation. These tests pin that
// client-side wall so a form refactor can't quietly demote it to a
// server-only rejection.

import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import NewBet from "../NewBet"
import NewParlay from "../NewParlay"

// ── Mocks (same surface as rationaleNudge.test.tsx) ─────────────────────────

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
  useUpdateUser: () => ({ mutate: vi.fn(), isPending: false }),
  getGetCurrentUserQueryKey: () => ["current-user"],
  usePreBetCheck: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateBillingCheckout: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
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
  localStorage.setItem("edgeboard-favorite-sports", JSON.stringify(["NFL"]))
})

// ── NewBet ───────────────────────────────────────────────────────────────────

describe("NewBet blocks out-of-range odds client-side", () => {
  function fillRequiredFields() {
    fireEvent.change(screen.getByLabelText(/event/i), { target: { value: "Chiefs vs Bills" } })
    fireEvent.change(screen.getByLabelText(/pick/i), { target: { value: "Chiefs -3" } })
    fireEvent.change(screen.getByTestId("input-rationale"), { target: { value: "Solid number" } })
  }

  it.each(["50", "0", "-99", "+99"])(
    "dead-zone odds %s show an inline error as you type",
    async (deadZone) => {
      renderPage(NewBet)
      fireEvent.change(screen.getByTestId("input-odds"), { target: { value: deadZone } })
      await waitFor(() => {
        expect(document.querySelector(".text-destructive")?.textContent ?? "").not.toBe("")
      })
    }
  )

  it("submitting with dead-zone odds never calls the create mutation", async () => {
    renderPage(NewBet)
    fillRequiredFields()
    fireEvent.change(screen.getByTestId("input-odds"), { target: { value: "50" } })

    fireEvent.click(screen.getByTestId("button-submit-bet"))

    // The zod resolver rejects; give the submit pipeline a beat to run.
    await new Promise((r) => setTimeout(r, 50))
    expect(mockCreateBetMutate).not.toHaveBeenCalled()
  })

  it("valid odds submit cleanly with the same fields", async () => {
    renderPage(NewBet)
    fillRequiredFields()
    fireEvent.change(screen.getByTestId("input-odds"), { target: { value: "-110" } })

    fireEvent.click(screen.getByTestId("button-submit-bet"))

    await waitFor(() => expect(mockCreateBetMutate).toHaveBeenCalledTimes(1))
    expect(mockCreateBetMutate.mock.calls[0][0].data.odds).toBe(-110)
  })
})

// ── NewParlay ────────────────────────────────────────────────────────────────

describe("NewParlay blocks out-of-range leg odds client-side", () => {
  function fillParlayForm() {
    fireEvent.change(screen.getByPlaceholderText("e.g. Sunday NFL Slate"), { target: { value: "Sunday Slate" } })
    const eventInputs = screen.getAllByPlaceholderText("e.g. Chiefs @ Raiders")
    const pickInputs = screen.getAllByPlaceholderText("Chiefs -3.5")
    fireEvent.change(eventInputs[0], { target: { value: "Chiefs @ Raiders" } })
    fireEvent.change(eventInputs[1], { target: { value: "Bills @ Jets" } })
    fireEvent.change(pickInputs[0], { target: { value: "Chiefs -3" } })
    fireEvent.change(pickInputs[1], { target: { value: "Over 47.5" } })
    fireEvent.change(screen.getByTestId("input-rationale"), { target: { value: "Correlated legs" } })
  }

  it("a dead-zone leg price blocks submit and never calls the create mutation", async () => {
    renderPage(NewParlay)
    fillParlayForm()
    fireEvent.change(screen.getByTestId("input-leg-odds-0"), { target: { value: "50" } })

    fireEvent.click(screen.getByTestId("button-submit-parlay"))

    await new Promise((r) => setTimeout(r, 50))
    expect(mockCreateParlayMutate).not.toHaveBeenCalled()
  })

  it("valid leg odds submit cleanly", async () => {
    renderPage(NewParlay)
    fillParlayForm()
    fireEvent.change(screen.getByTestId("input-leg-odds-0"), { target: { value: "+150" } })

    fireEvent.click(screen.getByTestId("button-submit-parlay"))

    await waitFor(() => expect(mockCreateParlayMutate).toHaveBeenCalledTimes(1))
  })
})
