/**
 * @vitest-environment jsdom
 *
 * First-run crew walk-in — the "get on a board" step after profile claim:
 *   - a crewless bettor sees join-with-code and start-a-crew side by side
 *   - an invite-link code pre-fills the join input
 *   - a bettor who already runs with a crew (and no invite code) is passed
 *     through silently
 *   - an invite code still shows the step even when they have a crew
 *   - the Pro pitch appears when the server says 402 (cap never client-side)
 *   - skip always works
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

let listCrewsResult: { data: unknown; isPending: boolean; isError: boolean; refetch: () => void }
let joinResult: Record<string, unknown>
let createResult: Record<string, unknown>

vi.mock("@workspace/api-client-react", () => ({
  useListCrews: () => listCrewsResult,
  getListCrewsQueryKey: () => ["/api/crews"],
  useCreateCrew: () => createResult,
  useJoinCrew: () => joinResult,
  useCreateBillingCheckout: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))

import { CrewOnboarding } from "../CrewOnboarding"

let queryClient: QueryClient
function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

const someCrew = [
  { id: 1, name: "The Day Ones", role: "member", inviteCode: "ABCD2345", memberCount: 4, isActive: true, createdAt: "2026-01-01T00:00:00Z" },
]

beforeEach(() => {
  queryClient = new QueryClient()
  listCrewsResult = { data: [], isPending: false, isError: false, refetch: vi.fn() }
  joinResult = { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }
  createResult = { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }
})

afterEach(() => cleanup())

describe("CrewOnboarding", () => {
  it("crewless bettor sees join and create options plus skip", () => {
    wrap(<CrewOnboarding onDone={vi.fn()} />)
    expect(screen.getByTestId("input-onboard-invite-code")).toBeTruthy()
    expect(screen.getByTestId("input-onboard-crew-name")).toBeTruthy()
    expect(screen.getByTestId("button-skip-crew-setup")).toBeTruthy()
  })

  it("pre-fills the join input from an invite-link code", () => {
    wrap(<CrewOnboarding initialCode="WXYZ6789" onDone={vi.fn()} />)
    const input = screen.getByTestId("input-onboard-invite-code") as HTMLInputElement
    expect(input.value).toBe("WXYZ6789")
    // Join button is enabled straight away — one tap to get on the board
    expect((screen.getByTestId("button-onboard-join") as HTMLButtonElement).disabled).toBe(false)
  })

  it("passes a crewed bettor through silently when there's no invite code", () => {
    listCrewsResult = { data: someCrew, isPending: false, isError: false, refetch: vi.fn() }
    const onDone = vi.fn()
    wrap(<CrewOnboarding onDone={onDone} />)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("input-onboard-invite-code")).toBeNull()
  })

  it("still shows the step for a crewed bettor arriving from an invite link", () => {
    listCrewsResult = { data: someCrew, isPending: false, isError: false, refetch: vi.fn() }
    const onDone = vi.fn()
    wrap(<CrewOnboarding initialCode="WXYZ6789" onDone={onDone} />)
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByTestId("input-onboard-invite-code")).toBeTruthy()
  })

  it("joining sends the typed code to the server", () => {
    const mutate = vi.fn()
    joinResult = { ...joinResult, mutate }
    wrap(<CrewOnboarding onDone={vi.fn()} />)
    fireEvent.change(screen.getByTestId("input-onboard-invite-code"), { target: { value: "abcd2345" } })
    fireEvent.click(screen.getByTestId("button-onboard-join"))
    expect(mutate).toHaveBeenCalledWith(
      { data: { inviteCode: "ABCD2345" } },
      expect.anything(),
    )
  })

  it("shows the 'no crew behind that code' message on 404", () => {
    joinResult = { ...joinResult, isError: true, error: { status: 404 } }
    wrap(<CrewOnboarding onDone={vi.fn()} />)
    expect(screen.getByTestId("text-onboard-join-error").textContent).toContain("No crew behind that code")
  })

  it("swaps to the Pro pitch when the server says 402", () => {
    joinResult = { ...joinResult, isError: true, error: { status: 402 } }
    wrap(<CrewOnboarding onDone={vi.fn()} />)
    expect(screen.queryByTestId("input-onboard-invite-code")).toBeNull()
    // Skip stays available — the velvet rope never traps anyone
    expect(screen.getByTestId("button-skip-crew-setup")).toBeTruthy()
  })

  it("skip calls onDone without touching the server", () => {
    const onDone = vi.fn()
    const joinMutate = vi.fn()
    const createMutate = vi.fn()
    joinResult = { ...joinResult, mutate: joinMutate }
    createResult = { ...createResult, mutate: createMutate }
    wrap(<CrewOnboarding onDone={onDone} />)
    fireEvent.click(screen.getByTestId("button-skip-crew-setup"))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(joinMutate).not.toHaveBeenCalled()
    expect(createMutate).not.toHaveBeenCalled()
  })
})
