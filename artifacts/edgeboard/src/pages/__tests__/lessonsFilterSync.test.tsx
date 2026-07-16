// @vitest-environment jsdom
//
// #167: the Lessons-page filters are saved on the profile so the bettor's
// view follows them across devices. These tests pin:
//   - hydration: the page opens with the profile's saved filter applied
//   - persistence: changing a filter PATCHes the profile with just that field
//   - demo isolation: with server sync off, no PATCH ever fires

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { LessonsResponse } from "@workspace/api-client-react"
import Lessons from "../Lessons"
import { setLessonsFiltersServerSync } from "@/hooks/use-lessons-filters"

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUseGetLessons = vi.fn()
const mockMutate = vi.fn()

vi.mock("@workspace/api-client-react", () => ({
  useGetLessons: (...args: unknown[]) => mockUseGetLessons(...args),
  getGetLessonsQueryKey: () => ["lessons"],
  useUpdateUser: () => ({ mutate: mockMutate }),
  getGetCurrentUserQueryKey: () => ["currentUser"],
}))

const activeUser = {
  id: 1,
  displayName: "Test Bettor",
  lessonsResultFilter: "lost",
  lessonsQualityFilter: "all",
  lessonsReasonFilter: "all",
}

vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({ activeUser, allUsers: [], isLoading: false, needsClaim: false, refreshUser: () => {} }),
}))

const lessons: LessonsResponse = {
  summary: {
    settledCount: 2,
    reviewedCount: 1,
    soundCount: 1,
    flawedCount: 0,
    missReasons: [],
    mostRepeatedMistake: null,
  },
  items: [
    {
      id: 11, type: "parlay", title: "Parlay: Sunday Special", sport: null, result: "lost",
      stake: 25, odds: 260, profit: -25, confidenceScore: 6, rationale: null,
      reasoningQuality: null, missReason: null, whatHappened: null, reviewed: false,
      settledAt: "2026-07-12T12:00:00Z",
    },
    {
      id: 7, type: "bet", title: "Lakers -3.5", sport: "NBA", result: "won",
      stake: 50, odds: -110, profit: 45.45, confidenceScore: 7, rationale: "Line moved",
      reasoningQuality: "sound", missReason: null, whatHappened: null, reviewed: true,
      settledAt: "2026-07-10T12:00:00Z",
    },
  ],
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Seed the current-user cache the saver hook reads for the optimistic write.
  qc.setQueryData(["currentUser"], { ...activeUser })
  render(
    <QueryClientProvider client={qc}>
      <Lessons />
    </QueryClientProvider>
  )
  return qc
}

beforeEach(() => {
  cleanup()
  mockUseGetLessons.mockReset()
  mockMutate.mockReset()
  setLessonsFiltersServerSync(true)
  mockUseGetLessons.mockReturnValue({ data: lessons, isLoading: false, isError: false, refetch: vi.fn(), isRefetching: false })
})

describe("Lessons filter cross-device sync", () => {
  it("hydrates the saved filter from the profile", () => {
    renderPage()
    // Saved view is "lost" — only the lost parlay is visible on first paint.
    expect(screen.getByTestId("card-lesson-parlay-11")).toBeTruthy()
    expect(screen.queryByTestId("card-lesson-bet-7")).toBeNull()
  })

  it("PATCHes the profile with just the changed filter", () => {
    const qc = renderPage()
    fireEvent.click(screen.getByTestId("chip-lessons-result-won"))
    expect(mockMutate).toHaveBeenCalledTimes(1)
    expect(mockMutate.mock.calls[0][0]).toEqual({ id: 1, data: { lessonsResultFilter: "won" } })
    // Optimistic cache write so a refetch can't hydrate the old view back.
    expect((qc.getQueryData(["currentUser"]) as { lessonsResultFilter: string }).lessonsResultFilter).toBe("won")
    // And the view actually switched.
    expect(screen.getByTestId("card-lesson-bet-7")).toBeTruthy()
    expect(screen.queryByTestId("card-lesson-parlay-11")).toBeNull()
  })

  it("never PATCHes when server sync is off (demo board)", () => {
    setLessonsFiltersServerSync(false)
    renderPage()
    fireEvent.click(screen.getByTestId("chip-lessons-quality-sound"))
    expect(mockMutate).not.toHaveBeenCalled()
    // Filter still applies locally: lost + sound matches nothing here.
    expect(screen.getByTestId("text-lessons-no-match")).toBeTruthy()
  })
})
