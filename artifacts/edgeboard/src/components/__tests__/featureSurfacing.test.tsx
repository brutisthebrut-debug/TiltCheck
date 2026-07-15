// @vitest-environment jsdom
//
// Feature-surfacing pass: the recap's unread dot in the nav, the trophy case
// gallery, and the first-week tour strip's dismiss persistence. Each of these
// is pure frontend presentation over existing data — a regression would
// quietly re-hide the features this pass exists to surface.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { User, BadgeStatus } from "@workspace/api-client-react"

// ── Shared mocks ─────────────────────────────────────────────────────────────

const mockUseGetUserBadges = vi.fn()

vi.mock("@workspace/api-client-react", () => ({
  useGetNeedsSettling: () => ({ data: { count: 0, bets: [], parlays: [] } }),
  getGetNeedsSettlingQueryKey: () => ["needs-settling"],
  useGetUserBadges: (...args: unknown[]) => mockUseGetUserBadges(...args),
  getGetUserBadgesQueryKey: (id: number) => ["user-badges", id],
}))

let activeUser: User | null = null
vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({ activeUser, allUsers: [], isLoading: false, needsClaim: false, refreshUser: () => {} }),
}))

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}))

vi.mock("@/components/CrewSwitcher", () => ({
  CrewSwitcher: () => null,
}))
vi.mock("@/components/BadgeWatcher", () => ({
  BadgeWatcher: () => null,
}))

import { Layout } from "../Layout"
import { TrophyCase } from "../TrophyCase"
import { FirstWeekStrip } from "../FirstWeekStrip"
import { latestRecapWeekStart } from "@/lib/recapTeaser"

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    username: "tester",
    displayName: "Tester",
    avatarColor: "#6366f1",
    startingBankroll: 1000,
    createdAt: new Date().toISOString(),
    recapSeenWeek: null,
    isFounder: false,
    oddsFormat: "american",
    ...overrides,
  } as User
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  activeUser = makeUser()
  mockUseGetUserBadges.mockReturnValue({ data: [], isLoading: false, isError: false })
})

// ── Recap unread dot ─────────────────────────────────────────────────────────

describe("recap nav unread indicator", () => {
  it("shows the dot when this week's recap is unopened", () => {
    activeUser = makeUser({ recapSeenWeek: null })
    wrap(<Layout><div /></Layout>)
    // Sidebar + mobile bottom nav each carry one.
    expect(screen.getAllByTestId("dot-recap-unread").length).toBeGreaterThanOrEqual(1)
  })

  it("hides the dot once the current week's recap has been opened", () => {
    activeUser = makeUser({ recapSeenWeek: latestRecapWeekStart() })
    wrap(<Layout><div /></Layout>)
    expect(screen.queryByTestId("dot-recap-unread")).toBeNull()
  })

  it("keeps a permanent Recap link in the nav either way", () => {
    activeUser = makeUser({ recapSeenWeek: latestRecapWeekStart() })
    wrap(<Layout><div /></Layout>)
    expect(screen.getAllByText("Recap").length).toBeGreaterThanOrEqual(1)
  })
})

// ── Trophy case ──────────────────────────────────────────────────────────────

const BADGES: BadgeStatus[] = [
  { id: "first_blood", name: "First Blood", emoji: "🩸", description: "Cashed your first winning play.", earnedAt: "2026-07-10T12:00:00Z" },
  { id: "hot_hand", name: "Hot Hand", emoji: "🔥", description: "Won 3 plays in a row.", earnedAt: null },
  { id: "sharp", name: "Certified Sharp", emoji: "🎯", description: "55%+ win rate across 20+ decided plays.", earnedAt: null },
]

describe("TrophyCase", () => {
  it("renders earned badges with their date and locked badges with criteria", () => {
    mockUseGetUserBadges.mockReturnValue({ data: BADGES, isLoading: false, isError: false })
    wrap(<TrophyCase userId={7} />)
    expect(screen.getByTestId("badge-earned-first_blood")).toBeTruthy()
    expect(screen.getByText(/Earned/)).toBeTruthy()
    expect(screen.getByTestId("badge-locked-hot_hand")).toBeTruthy()
    // Locked criteria stay readable — that's the point of the case.
    expect(screen.getByText("Won 3 plays in a row.")).toBeTruthy()
    expect(screen.getByText(/1 of 3 claimed/)).toBeTruthy()
  })

  it("shows the full menu when nothing is earned yet", () => {
    mockUseGetUserBadges.mockReturnValue({
      data: BADGES.map((b) => ({ ...b, earnedAt: null })),
      isLoading: false,
      isError: false,
    })
    wrap(<TrophyCase userId={7} />)
    expect(screen.getByText(/3 badges up for grabs/)).toBeTruthy()
  })

  it("renders nothing when the badge fetch failed", () => {
    mockUseGetUserBadges.mockReturnValue({ data: [], isLoading: false, isError: true })
    wrap(<TrophyCase userId={7} />)
    expect(screen.queryByTestId("card-trophy-case")).toBeNull()
  })
})

// ── First-week strip ─────────────────────────────────────────────────────────

describe("FirstWeekStrip", () => {
  it("shows for a fresh account and hides forever once dismissed", () => {
    activeUser = makeUser()
    const { unmount } = wrap(<FirstWeekStrip />)
    expect(screen.getByTestId("strip-first-week")).toBeTruthy()

    fireEvent.click(screen.getByTestId("button-dismiss-first-week"))
    expect(screen.queryByTestId("strip-first-week")).toBeNull()

    // Fresh mount — the dismissal must survive via storage.
    unmount()
    wrap(<FirstWeekStrip />)
    expect(screen.queryByTestId("strip-first-week")).toBeNull()
  })

  it("never shows for accounts older than two weeks", () => {
    activeUser = makeUser({ createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString() })
    wrap(<FirstWeekStrip />)
    expect(screen.queryByTestId("strip-first-week")).toBeNull()
  })

  it("keeps the tour strip out of the accessibility shadows", () => {
    activeUser = makeUser()
    wrap(<FirstWeekStrip />)
    expect(screen.getByRole("button", { name: /dismiss tour/i })).toBeTruthy()
  })

  it("scopes the dismissal to the user", () => {
    activeUser = makeUser({ id: 7 })
    const { unmount } = wrap(<FirstWeekStrip />)
    fireEvent.click(screen.getByTestId("button-dismiss-first-week"))
    unmount()

    activeUser = makeUser({ id: 8 })
    wrap(<FirstWeekStrip />)
    expect(screen.getByTestId("strip-first-week")).toBeTruthy()
  })
})
