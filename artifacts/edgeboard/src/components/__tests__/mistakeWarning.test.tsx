/**
 * @vitest-environment jsdom
 *
 * MistakeWarning — the Lessons feed's top signal at bet-creation time:
 *   - warns when the dominant miss reason is controllable with >=2 hits
 *   - stays silent for normal_variance / lineup_injury (not the bettor's fault)
 *   - stays silent when data is thin (count < 2) or missing
 *   - the personal decision engine is available without multi-Crew access
 *   - dismiss hides it and remembers for the session (per reason)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

let insightsResult: { data: unknown }
let queryEnabled: boolean | undefined

vi.mock("@workspace/api-client-react", () => ({
  useGetStatsInsights: (_params: unknown, opts: { query?: { enabled?: boolean } }) => {
    queryEnabled = opts?.query?.enabled
    return insightsResult
  },
  getGetStatsInsightsQueryKey: () => ["/api/stats/insights"],
}))

vi.mock("@/contexts/UserContext", () => ({
  useUser: () => ({ activeUser: { id: 10, displayName: "Me" } }),
}))

import { MistakeWarning } from "../MistakeWarning"

const insights = (missReasons: { reason: string; count: number }[], lossesWithReason = 5) => ({
  reviewedCount: 8,
  lossesWithReason,
  missReasons,
  soundReasoning: { total: 0, wins: 0, winRate: 0 },
  flawedReasoning: { total: 0, wins: 0, winRate: 0 },
  recentNotes: [],
})

let queryClient: QueryClient
function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  queryClient = new QueryClient()
  queryEnabled = undefined
  insightsResult = { data: undefined }
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe("MistakeWarning", () => {
  it("warns when the dominant miss reason is controllable with >=2 occurrences", () => {
    insightsResult = { data: insights([{ reason: "emotional", count: 3 }, { reason: "bad_read", count: 1 }]) }
    wrap(<MistakeWarning />)
    const banner = screen.getByTestId("warning-mistake-emotional")
    expect(banner.textContent).toContain("3 of your 5 reviewed losses")
    expect(banner.textContent).toContain("emotional")
  })

  it.each(["bad_read", "bad_price", "misunderstood_market"])("also fires for %s", (reason) => {
    insightsResult = { data: insights([{ reason, count: 2 }]) }
    wrap(<MistakeWarning />)
    expect(screen.getByTestId(`warning-mistake-${reason}`)).toBeTruthy()
  })

  it("stays silent when the dominant reason is normal_variance", () => {
    insightsResult = { data: insights([{ reason: "normal_variance", count: 4 }, { reason: "emotional", count: 2 }]) }
    wrap(<MistakeWarning />)
    expect(screen.queryByTestId(/warning-mistake/)).toBeNull()
  })

  it("stays silent for lineup_injury — not a controllable miss", () => {
    insightsResult = { data: insights([{ reason: "lineup_injury", count: 3 }]) }
    wrap(<MistakeWarning />)
    expect(screen.queryByTestId(/warning-mistake/)).toBeNull()
  })

  it("stays silent when data is thin (count < 2)", () => {
    insightsResult = { data: insights([{ reason: "emotional", count: 1 }], 1) }
    wrap(<MistakeWarning />)
    expect(screen.queryByTestId(/warning-mistake/)).toBeNull()
  })

  it("stays silent with no miss reasons at all", () => {
    insightsResult = { data: insights([], 0) }
    wrap(<MistakeWarning />)
    expect(screen.queryByTestId(/warning-mistake/)).toBeNull()
  })

  it("keeps the insight query enabled for a standard account", () => {
    insightsResult = { data: insights([], 0) }
    wrap(<MistakeWarning />)
    expect(queryEnabled).toBe(true)
    expect(screen.queryByTestId(/warning-mistake/)).toBeNull()
  })

  it("dismiss hides the banner and keeps it hidden on remount (same session, same reason)", () => {
    insightsResult = { data: insights([{ reason: "bad_price", count: 2 }]) }
    wrap(<MistakeWarning />)
    fireEvent.click(screen.getByTestId("button-dismiss-mistake-warning"))
    expect(screen.queryByTestId("warning-mistake-bad_price")).toBeNull()

    cleanup()
    wrap(<MistakeWarning />)
    expect(screen.queryByTestId("warning-mistake-bad_price")).toBeNull()
  })

  it("a different dominant reason still shows after dismissing the old one", () => {
    insightsResult = { data: insights([{ reason: "bad_price", count: 2 }]) }
    wrap(<MistakeWarning />)
    fireEvent.click(screen.getByTestId("button-dismiss-mistake-warning"))
    cleanup()

    insightsResult = { data: insights([{ reason: "emotional", count: 3 }]) }
    wrap(<MistakeWarning />)
    expect(screen.getByTestId("warning-mistake-emotional")).toBeTruthy()
  })
})
