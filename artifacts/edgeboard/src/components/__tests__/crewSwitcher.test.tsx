/**
 * @vitest-environment jsdom
 *
 * Crew switcher — the multi-crew surface and its Pro velvet rope:
 *   - shows the active crew name from the server's list
 *   - crewless bettors get the "No crew yet" label
 *   - the create dialog swaps to the Pro pitch when the server says 402
 *     (the cap is never decided client-side)
 *   - demo mode (actions off) hides create/join entirely
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

const crews = [
  { id: 1, name: "The Day Ones", role: "owner", inviteCode: "ABCD2345", memberCount: 4, isActive: true, createdAt: "2026-01-01T00:00:00Z" },
  { id: 2, name: "Side Board", role: "member", inviteCode: "WXYZ6789", memberCount: 2, isActive: false, createdAt: "2026-02-01T00:00:00Z" },
]

let listCrewsResult: { data: unknown; isPending: boolean; isError: boolean; refetch: () => void }
let createResult: Record<string, unknown>

const idleMutation = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null })

let membersResult: { data: unknown; isPending: boolean }

vi.mock("@workspace/api-client-react", () => ({
  useListCrews: () => listCrewsResult,
  getListCrewsQueryKey: () => ["/api/crews"],
  useCreateCrew: () => createResult,
  useJoinCrew: () => idleMutation(),
  useActivateCrew: () => idleMutation(),
  useCreateBillingCheckout: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useGetCurrentUser: () => ({ data: { id: 10 } }),
  getGetCurrentUserQueryKey: () => ["/api/users/me"],
  useListCrewMembers: () => membersResult,
  getListCrewMembersQueryKey: (id: number) => [`/api/crews/${id}/members`],
  useLeaveCrew: () => idleMutation(),
  useRemoveCrewMember: () => idleMutation(),
  useTransferCrewOwnership: () => idleMutation(),
  useDeleteCrew: () => idleMutation(),
}))

import { CrewSwitcher } from "../CrewSwitcher"
import { setCrewActionsEnabled } from "@/hooks/use-crews"

let queryClient: QueryClient
function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  queryClient = new QueryClient()
  setCrewActionsEnabled(true)
  listCrewsResult = { data: crews, isPending: false, isError: false, refetch: vi.fn() }
  createResult = { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }
  membersResult = {
    data: [
      { userId: 10, displayName: "Me", username: "me", role: "owner", joinedAt: "2026-01-01T00:00:00Z" },
      { userId: 11, displayName: "Dana", username: "dana", role: "member", joinedAt: "2026-01-02T00:00:00Z" },
    ],
    isPending: false,
  }
})

afterEach(() => {
  cleanup()
  setCrewActionsEnabled(true)
})

describe("CrewSwitcher", () => {
  it("shows the active crew name on the trigger", () => {
    wrap(<CrewSwitcher />)
    expect(screen.getByTestId("button-crew-switcher").textContent).toContain("The Day Ones")
  })

  it("crewless bettors see 'No crew yet'", () => {
    listCrewsResult = { data: [], isPending: false, isError: false, refetch: vi.fn() }
    wrap(<CrewSwitcher />)
    expect(screen.getByTestId("button-crew-switcher").textContent).toContain("No crew yet")
  })

  it("lists crews and offers create/join when actions are on", () => {
    wrap(<CrewSwitcher />)
    fireEvent.keyDown(screen.getByTestId("button-crew-switcher"), { key: "Enter" })
    expect(screen.getByTestId("item-crew-1").textContent).toContain("The Day Ones")
    expect(screen.getByTestId("item-crew-2").textContent).toContain("Side Board")
    expect(screen.getByTestId("item-create-crew")).toBeTruthy()
    expect(screen.getByTestId("item-join-crew")).toBeTruthy()
  })

  it("demo mode hides create/join — the demo crew is sealed", () => {
    setCrewActionsEnabled(false)
    wrap(<CrewSwitcher />)
    fireEvent.keyDown(screen.getByTestId("button-crew-switcher"), { key: "Enter" })
    expect(screen.getByTestId("item-crew-1")).toBeTruthy()
    expect(screen.queryByTestId("item-create-crew")).toBeNull()
    expect(screen.queryByTestId("item-join-crew")).toBeNull()
  })

  it("manage dialog: the owner gets kick/transfer/delete, never a leave button", () => {
    wrap(<CrewSwitcher />)
    fireEvent.keyDown(screen.getByTestId("button-crew-switcher"), { key: "Enter" })
    fireEvent.click(screen.getByTestId("item-manage-crew"))
    expect(screen.getByTestId("row-member-11").textContent).toContain("Dana")
    expect(screen.getByTestId("button-transfer-11")).toBeTruthy()
    expect(screen.getByTestId("button-remove-11")).toBeTruthy()
    expect(screen.queryByTestId("button-transfer-10")).toBeNull()
    expect(screen.getByTestId("button-delete-crew")).toBeTruthy()
    expect(screen.queryByTestId("button-leave-crew")).toBeNull()
  })

  it("manage dialog: a plain member only gets the door", () => {
    listCrewsResult = {
      data: [{ ...crews[0], role: "member" }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }
    wrap(<CrewSwitcher />)
    fireEvent.keyDown(screen.getByTestId("button-crew-switcher"), { key: "Enter" })
    fireEvent.click(screen.getByTestId("item-manage-crew"))
    expect(screen.getByTestId("button-leave-crew")).toBeTruthy()
    expect(screen.queryByTestId("button-delete-crew")).toBeNull()
    expect(screen.queryByTestId("button-remove-11")).toBeNull()
  })

  it("destructive moves go through an inline confirm first", () => {
    wrap(<CrewSwitcher />)
    fireEvent.keyDown(screen.getByTestId("button-crew-switcher"), { key: "Enter" })
    fireEvent.click(screen.getByTestId("item-manage-crew"))
    fireEvent.click(screen.getByTestId("button-delete-crew"))
    expect(screen.getByTestId("text-confirm-action").textContent).toContain("Shut down")
    fireEvent.click(screen.getByTestId("button-cancel-action"))
    expect(screen.queryByTestId("text-confirm-action")).toBeNull()
  })

  it("demo mode hides the manage entry too", () => {
    setCrewActionsEnabled(false)
    wrap(<CrewSwitcher />)
    fireEvent.keyDown(screen.getByTestId("button-crew-switcher"), { key: "Enter" })
    expect(screen.queryByTestId("item-manage-crew")).toBeNull()
  })

  it("a 402 from create swaps the dialog to the Pro pitch", () => {
    createResult = {
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: true,
      error: Object.assign(new Error("Payment Required"), { status: 402 }),
    }
    wrap(<CrewSwitcher />)
    fireEvent.keyDown(screen.getByTestId("button-crew-switcher"), { key: "Enter" })
    fireEvent.click(screen.getByTestId("item-create-crew"))
    expect(screen.getByTestId("card-upgrade-pro")).toBeTruthy()
    expect(screen.queryByTestId("input-crew-name")).toBeNull()
  })
})
