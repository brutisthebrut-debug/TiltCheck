// @vitest-environment jsdom
//
// The Lesson Library page turns the lessons feed into the app's core review
// surface: a summary strip (reviewed count, sound/flawed ratio, most repeated
// mistake), client-side filters over result / reasoning quality / miss
// reason, and a per-item "grade the call" prompt for settled plays with no
// post-mortem. These tests pin the summary figures, the filter behavior, the
// unreviewed prompt's deep link, and the empty state.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import type { User, LessonsResponse } from "@workspace/api-client-react"
import Lessons from "../Lessons"

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUseGetLessons = vi.fn()

vi.mock("@workspace/api-client-react", () => ({
  useGetLessons: (...args: unknown[]) => mockUseGetLessons(...args),
  getGetLessonsQueryKey: () => ["lessons"],
}))

const activeUser = { id: 1, displayName: "Test Bettor" } as unknown as User

vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({ activeUser, allUsers: [], isLoading: false, needsClaim: false, refreshUser: () => {} }),
}))

function queryResult(data: unknown) {
  return { data, isLoading: false, isError: false, refetch: vi.fn(), isRefetching: false }
}

const emptyLessons: LessonsResponse = {
  summary: { settledCount: 0, reviewedCount: 0, soundCount: 0, flawedCount: 0, missReasons: [], mostRepeatedMistake: null },
  items: [],
}

const richLessons: LessonsResponse = {
  summary: {
    settledCount: 3,
    reviewedCount: 2,
    soundCount: 1,
    flawedCount: 1,
    missReasons: [{ reason: "emotional", count: 2 }],
    mostRepeatedMistake: { reason: "emotional", count: 2 },
  },
  items: [
    {
      id: 11,
      type: "parlay",
      title: "Parlay: Sunday Special",
      sport: null,
      result: "lost",
      stake: 25,
      odds: 260,
      profit: -25,
      confidenceScore: 6,
      rationale: "Felt unstoppable",
      reasoningQuality: "flawed",
      missReason: "emotional",
      whatHappened: "Chased the early loss",
      reviewed: true,
      settledAt: "2026-07-12T12:00:00Z",
    },
    {
      id: 7,
      type: "bet",
      title: "Lakers -3.5 (LAL @ BOS)",
      sport: "NBA",
      result: "won",
      stake: 50,
      odds: -110,
      profit: 45.45,
      confidenceScore: 7,
      rationale: "Line moved my way all week",
      reasoningQuality: "sound",
      missReason: null,
      whatHappened: null,
      reviewed: true,
      settledAt: "2026-07-10T12:00:00Z",
    },
    {
      id: 8,
      type: "bet",
      title: "Yankees ML (NYY @ TOR)",
      sport: "MLB",
      result: "push",
      stake: 30,
      odds: 100,
      profit: 0,
      confidenceScore: 4,
      rationale: null,
      reasoningQuality: null,
      missReason: null,
      whatHappened: null,
      reviewed: false,
      settledAt: "2026-07-09T12:00:00Z",
    },
  ],
}

beforeEach(() => {
  cleanup()
  mockUseGetLessons.mockReset()
})

describe("Lesson Library page", () => {
  it("shows the empty state when nothing has settled", () => {
    mockUseGetLessons.mockReturnValue(queryResult(emptyLessons))
    render(<Lessons />)
    expect(screen.getByText("No settled plays yet")).toBeTruthy()
    expect(screen.getByTestId("button-lessons-first-bet")).toBeTruthy()
  })

  it("renders the summary strip figures", () => {
    mockUseGetLessons.mockReturnValue(queryResult(richLessons))
    render(<Lessons />)
    expect(screen.getByTestId("text-lessons-reviewed").textContent).toContain("2")
    expect(screen.getByTestId("text-lessons-reviewed").textContent).toContain("of 3")
    expect(screen.getByTestId("text-lessons-quality-ratio").textContent).toContain("1")
    expect(screen.getByTestId("text-lessons-top-mistake").textContent).toContain("Emotional bet")
  })

  it("lists every settled play and prompts to grade the unreviewed one", () => {
    mockUseGetLessons.mockReturnValue(queryResult(richLessons))
    render(<Lessons />)
    expect(screen.getByTestId("card-lesson-parlay-11")).toBeTruthy()
    expect(screen.getByTestId("card-lesson-bet-7")).toBeTruthy()
    expect(screen.getByTestId("card-lesson-bet-8")).toBeTruthy()
    const prompt = screen.getByTestId("link-lesson-review-bet-8")
    expect(prompt.getAttribute("href")).toContain("/bets/8")
    expect(screen.getByText("Chased the early loss")).toBeTruthy()
    expect(screen.getByText("Line moved my way all week")).toBeTruthy()
  })

  it("filters by result, reasoning quality, and miss reason", () => {
    mockUseGetLessons.mockReturnValue(queryResult(richLessons))
    render(<Lessons />)

    fireEvent.click(screen.getByTestId("chip-lessons-result-lost"))
    expect(screen.getByTestId("card-lesson-parlay-11")).toBeTruthy()
    expect(screen.queryByTestId("card-lesson-bet-7")).toBeNull()

    fireEvent.click(screen.getByTestId("chip-lessons-result-all"))
    fireEvent.click(screen.getByTestId("chip-lessons-quality-ungraded"))
    expect(screen.getByTestId("card-lesson-bet-8")).toBeTruthy()
    expect(screen.queryByTestId("card-lesson-parlay-11")).toBeNull()

    fireEvent.click(screen.getByTestId("chip-lessons-quality-all"))
    fireEvent.click(screen.getByTestId("chip-lessons-reason-emotional"))
    expect(screen.getByTestId("card-lesson-parlay-11")).toBeTruthy()
    expect(screen.queryByTestId("card-lesson-bet-7")).toBeNull()
    expect(screen.queryByTestId("card-lesson-bet-8")).toBeNull()
  })

  it("shows the no-match card when filters exclude everything", () => {
    mockUseGetLessons.mockReturnValue(queryResult(richLessons))
    render(<Lessons />)
    fireEvent.click(screen.getByTestId("chip-lessons-result-won"))
    fireEvent.click(screen.getByTestId("chip-lessons-quality-flawed"))
    expect(screen.getByTestId("text-lessons-no-match")).toBeTruthy()
  })
})
