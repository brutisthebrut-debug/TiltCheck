// @vitest-environment jsdom
//
// Every major page renders a "didn't load" card with a Retry button when its
// primary query fails. That behavior was only ever verified by reading the
// code — these tests actually mount each page with failing queries and assert
// the error card's testid appears, so removing an isError branch (or renaming
// a testid the smoke tests depend on) fails CI instead of shipping a blank
// page. The Bets page additionally exercises the full retry loop through real
// react-query: fetch fails → error card → click Retry → fetch succeeds →
// normal content returns.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ── Generated API client mock ────────────────────────────────────────────────
// The pages under test import dozens of generated hooks between them. Instead
// of enumerating every export (which silently breaks when a page gains a new
// hook), a Proxy fabricates exports on demand by naming convention:
//   use{Get,List}*  → a failed query result (the point of this suite)
//   use*            → an idle mutation
//   *QueryKey       → a stable key function
//   anything else   → a network fn that rejects (overridable per test)
const h = vi.hoisted(() => {
  const refetchSpies: Record<string, ReturnType<typeof vi.fn>> = {}
  const netFns: Record<string, ReturnType<typeof vi.fn>> = {}
  const failedQuery = (name: string) => ({
    data: undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isRefetching: false,
    isError: true,
    error: new Error("network down"),
    refetch: (refetchSpies[name] ??= vi.fn()),
  })
  const idleMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  })
  const makeExport = (name: string): unknown => {
    if (/QueryKey$/.test(name)) return (...args: unknown[]) => [name, ...args]
    if (/^use(Get|List)/.test(name)) return () => failedQuery(name)
    if (/^use/.test(name)) return () => idleMutation()
    return (netFns[name] ??= vi.fn(() => Promise.reject(new Error("network down"))))
  }
  return { refetchSpies, netFns, makeExport }
})

vi.mock("@workspace/api-client-react", () => {
  const cache = new Map<string, unknown>()
  return new Proxy(
    {},
    {
      get(_target, prop) {
        // vitest / module interop probes these; they must not be functions.
        if (typeof prop !== "string" || prop === "then" || prop === "default") return undefined
        if (prop === "__esModule") return true
        if (!cache.has(prop)) cache.set(prop, h.makeExport(prop))
        return cache.get(prop)
      },
      has: () => true,
    },
  )
})

// ── Environment mocks ────────────────────────────────────────────────────────

const activeUser = {
  id: 1,
  name: "Test Bettor",
  displayName: "Test Bettor",
  username: "testbettor",
  // Already seen every possible week → the Recap page never fires its
  // mark-seen mutation during these render-only tests.
  recapSeenWeek: "9999-12-27",
}

vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({
    activeUser,
    allUsers: [activeUser],
    isLoading: false,
    needsClaim: false,
    refreshUser: () => {},
  }),
}))

// Detail pages read :id from the route; list pages read the search string.
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useParams: () => ({ id: "7" }),
  useLocation: () => ["/", vi.fn()],
  useSearch: () => "",
  useRoute: () => [false, null],
  Redirect: () => null,
}))

// Account pulls in Clerk (sign-out on delete) and the push-notification
// lifecycle hook; neither matters for the error-card behavior under test.
vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}))

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    supported: false,
    permission: "default",
    subscribed: false,
    prefs: { notifyOverdue: true, notifyTilt: true, notifyCrewActivity: true },
    loading: false,
    requestAndSubscribe: vi.fn(),
    unsubscribe: vi.fn(),
    updatePref: vi.fn(),
  }),
}))

// ── Pages under test ─────────────────────────────────────────────────────────
// Imported after the mocks above (vi.mock is hoisted, so order here is safe).

import Dashboard from "../Dashboard"
import Stats from "../Stats"
import Bankroll from "../Bankroll"
import Workspace from "../Workspace"
import Bets from "../Bets"
import Parlays from "../Parlays"
import BetDetail from "../BetDetail"
import ParlayDetail from "../ParlayDetail"
import Recap from "../Recap"
import Account from "../Account"

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  // Restore the default "network down" behavior on the raw fetch fns that
  // Bets/Parlays drive through real react-query (clearAllMocks wipes impls).
  for (const fn of Object.values(h.netFns)) {
    fn.mockImplementation(() => Promise.reject(new Error("network down")))
  }
})

// ── One error card per page ──────────────────────────────────────────────────

const PAGE_CASES: Array<{ page: string; element: React.ReactElement; testId: string }> = [
  { page: "Dashboard", element: <Dashboard />, testId: "card-dashboard-error" },
  { page: "Stats", element: <Stats />, testId: "card-stats-error" },
  { page: "Bankroll", element: <Bankroll />, testId: "card-bankroll-error" },
  { page: "Leaderboard (Workspace)", element: <Workspace />, testId: "card-leaderboard-error" },
  { page: "Bets", element: <Bets />, testId: "card-bets-error" },
  { page: "Parlays", element: <Parlays />, testId: "card-parlays-error" },
  { page: "BetDetail", element: <BetDetail />, testId: "card-bet-detail-error" },
  { page: "ParlayDetail", element: <ParlayDetail />, testId: "card-parlay-detail-error" },
  { page: "Recap", element: <Recap />, testId: "card-recap-error" },
  // Account's primary query is the server-verified billing status; when it
  // fails the plan is unknown, so the page must show a neutral retry card
  // instead of a skeleton (or worse, an upgrade pitch at a paying user).
  { page: "Account", element: <Account />, testId: "card-account-error" },
]

describe("every page shows its retry card when its primary query fails", () => {
  for (const { page, element, testId } of PAGE_CASES) {
    it(`${page} renders ${testId}`, async () => {
      renderPage(element)
      // findBy: Bets/Parlays go through real react-query, so the failure
      // lands a tick after mount; the hook-mocked pages resolve immediately.
      expect(await screen.findByTestId(testId)).toBeTruthy()
    })
  }
})

// ── Retry actually refetches ─────────────────────────────────────────────────

describe("clicking Retry", () => {
  it("triggers a refetch of every failed primary query (Dashboard)", async () => {
    renderPage(<Dashboard />)
    // Dashboard's mount-time effect already auto-retries the secondary
    // queries once; only count calls from the button press itself.
    const spies = [
      h.refetchSpies["useGetStatsSummary"],
      h.refetchSpies["useGetRecentActivity"],
      h.refetchSpies["useGetBankroll"],
    ]
    for (const spy of spies) spy.mockClear()

    fireEvent.click(await screen.findByTestId("card-dashboard-error-retry"))
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
  })

  it("refetches the billing status (Account)", async () => {
    renderPage(<Account />)
    const spy = h.refetchSpies["useGetBillingStatus"]
    spy.mockClear()

    fireEvent.click(await screen.findByTestId("card-account-error-retry"))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("restores normal content once the response succeeds (Bets)", async () => {
    const bet = {
      id: 7,
      userId: 1,
      userName: "Test Bettor",
      gameDate: "2026-07-10",
      pick: "Lakers -3.5",
      event: "Lakers @ Celtics",
      betType: "spread",
      odds: -110,
      stake: "50",
      status: "pending",
      createdAt: "2026-07-10T12:00:00Z",
    }
    // First page load fails, the retry succeeds.
    h.netFns["listBets"]
      .mockImplementationOnce(() => Promise.reject(new Error("network down")))
      .mockImplementation(() => Promise.resolve([bet]))

    renderPage(<Bets />)
    const errorCard = await screen.findByTestId("card-bets-error")
    expect(errorCard).toBeTruthy()

    fireEvent.click(screen.getByTestId("card-bets-error-retry"))

    // Success replaces the error card with the bets table.
    await waitFor(() => {
      expect(screen.queryByTestId("card-bets-error")).toBeNull()
      expect(screen.getAllByText("Lakers -3.5").length).toBeGreaterThan(0)
    })
  })
})
