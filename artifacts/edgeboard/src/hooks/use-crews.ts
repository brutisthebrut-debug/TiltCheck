import {
  useListCrews,
  getListCrewsQueryKey,
  type Crew as ApiCrew,
} from "@workspace/api-client-react"

// The public demo board is a sealed, read-only world: the switcher shows the
// fictional crew but never offers create/join/switch. DemoApp flips this off
// the same way it does billing and odds-format server sync.
let crewActionsEnabled = true
export function setCrewActionsEnabled(enabled: boolean) {
  crewActionsEnabled = enabled
}
export function getCrewActionsEnabled(): boolean {
  return crewActionsEnabled
}

export type Crew = ApiCrew

/**
 * The signed-in bettor's crews. The server decides which crew is active —
 * that's the one the leaderboard, head-to-head, and recap highlights cover.
 */
export function useCrews() {
  const query = useListCrews({
    query: {
      queryKey: getListCrewsQueryKey(),
      staleTime: 30_000,
    },
  })
  const crews = query.data ?? []
  const activeCrew = crews.find((c) => c.isActive) ?? crews[0] ?? null
  return {
    crews,
    activeCrew,
    isLoading: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  }
}
