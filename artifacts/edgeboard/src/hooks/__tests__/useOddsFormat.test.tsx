/**
 * @vitest-environment jsdom
 *
 * Odds-format preference — local behavior plus server sync rules:
 *   - setter always applies locally (localStorage + change event)
 *   - signed-in: setter PATCHes the profile and optimistically updates the
 *     current-user cache; hydration copies the profile preference in
 *   - demo board (server sync off): no PATCH attempts, no hydration overwrite
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

const mutateMock = vi.fn()
vi.mock("@workspace/api-client-react", () => ({
  useUpdateUser: () => ({ mutate: mutateMock }),
  getGetCurrentUserQueryKey: () => ["/api/users/me"],
}))

import {
  useOddsFormat,
  getOddsFormat,
  syncOddsFormatFromServer,
  setOddsFormatServerSync,
} from "../use-odds-format"

const me = { id: 7, oddsFormat: "american" }

let queryClient: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeEach(() => {
  localStorage.clear()
  mutateMock.mockReset()
  setOddsFormatServerSync(true)
  queryClient = new QueryClient()
})

afterEach(() => {
  setOddsFormatServerSync(true)
})

describe("useOddsFormat", () => {
  it("signed-in: setter applies locally, optimistically updates the cache, and PATCHes", () => {
    queryClient.setQueryData(["/api/users/me"], me)
    const { result } = renderHook(() => useOddsFormat(), { wrapper })

    act(() => result.current[1]("decimal"))

    expect(getOddsFormat()).toBe("decimal")
    expect(result.current[0]).toBe("decimal")
    expect(queryClient.getQueryData(["/api/users/me"])).toMatchObject({ oddsFormat: "decimal" })
    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({ id: 7, data: { oddsFormat: "decimal" } })
  })

  it("signed-in: no PATCH when the profile already matches", () => {
    queryClient.setQueryData(["/api/users/me"], { ...me, oddsFormat: "decimal" })
    const { result } = renderHook(() => useOddsFormat(), { wrapper })

    act(() => result.current[1]("decimal"))

    expect(getOddsFormat()).toBe("decimal")
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it("hydration copies the profile preference into local storage", () => {
    syncOddsFormatFromServer("fractional")
    expect(getOddsFormat()).toBe("fractional")

    // Unknown values are ignored, not stored
    syncOddsFormatFromServer("martian")
    expect(getOddsFormat()).toBe("fractional")
  })

  it("demo board: setter stays local-only and hydration is a no-op", () => {
    setOddsFormatServerSync(false)
    queryClient.setQueryData(["/api/users/me"], me) // demo persona in cache
    const { result } = renderHook(() => useOddsFormat(), { wrapper })

    act(() => result.current[1]("decimal"))
    expect(getOddsFormat()).toBe("decimal")
    expect(mutateMock).not.toHaveBeenCalled()

    // The demo persona's saved preference must not overwrite the local choice
    syncOddsFormatFromServer("american")
    expect(getOddsFormat()).toBe("decimal")
  })
})
