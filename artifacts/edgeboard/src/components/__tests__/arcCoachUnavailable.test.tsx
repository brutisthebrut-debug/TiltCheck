// @vitest-environment jsdom
//
// Arc pre-bet coaching failure UX (#184): when the provider is down or slow,
// the button resets AND a one-line "Arc is taking a breather" note appears —
// no silent reset, no blocked form. A later success clears the note.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { ArcCoachNote } from "../ArcCoachNote"

// ── Mocks ────────────────────────────────────────────────────────────────────

// Flip between failure and success per test.
let providerMode: "fail" | "succeed" = "fail"

vi.mock("@workspace/api-client-react", () => ({
  usePreBetCheck: (opts: {
    mutation: { onSuccess: (d: { note: string }) => void; onError: (e: unknown) => void }
  }) => ({
    isPending: false,
    mutate: () => {
      if (providerMode === "fail") opts.mutation.onError(new Error("503 coaching_unavailable"))
      else opts.mutation.onSuccess({ note: "You're 2-9 on NBA dogs. Your call." })
    },
  }),
  useCreateBillingCheckout: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))

vi.mock("@/hooks/use-pro", () => ({
  useProStatus: () => ({ isPro: true, isLoading: false }),
}))

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  providerMode = "fail"
})

const PROPS = { enabled: true, sport: "NBA", odds: -110 }

describe("ArcCoachNote provider-failure fallback", () => {
  it("shows the unavailable note on failure and keeps the button usable", async () => {
    render(<ArcCoachNote {...PROPS} />)

    fireEvent.click(screen.getByTestId("button-arc-coach-check"))

    await waitFor(() => expect(screen.getByTestId("text-arc-coach-unavailable")).toBeTruthy())
    expect(screen.getByTestId("text-arc-coach-unavailable").textContent).toContain("Arc is taking a breather")
    // The form is never blocked — the button is still there to retry.
    expect(screen.getByTestId("button-arc-coach-check")).toBeTruthy()
    expect(screen.queryByTestId("arc-coach-note")).toBeNull()
  })

  it("a successful retry clears the unavailable note and shows the coaching note", async () => {
    render(<ArcCoachNote {...PROPS} />)

    fireEvent.click(screen.getByTestId("button-arc-coach-check"))
    await waitFor(() => expect(screen.getByTestId("text-arc-coach-unavailable")).toBeTruthy())

    providerMode = "succeed"
    fireEvent.click(screen.getByTestId("button-arc-coach-check"))

    await waitFor(() => expect(screen.getByTestId("arc-coach-note")).toBeTruthy())
    expect(screen.queryByTestId("text-arc-coach-unavailable")).toBeNull()
  })
})
