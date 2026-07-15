import { useGetBillingStatus, getGetBillingStatusQueryKey } from "@workspace/api-client-react"

// The public demo board never talks to /billing: the demo API doesn't mount
// billing routes, and the demo world is always Pro — the demo IS the pitch.
// DemoApp flips this off the same way it does odds-format server sync.
let billingServerSync = true
export function setBillingServerSync(enabled: boolean) {
  billingServerSync = enabled
}

/**
 * Server-verified Pro status for gating the insight layer. The server is the
 * only authority — this hook just reads GET /billing/status. While the status
 * is loading, callers should keep their skeletons up rather than flashing an
 * upgrade card at a paying user.
 */
export function useProStatus() {
  const query = useGetBillingStatus({
    query: {
      enabled: billingServerSync,
      queryKey: getGetBillingStatusQueryKey(),
      staleTime: 60_000,
    },
  })
  if (!billingServerSync) {
    return {
      isPro: true,
      isProLoading: false,
      isProUnknown: false,
      isProRefreshing: false,
      status: null,
      refreshPro: () => {},
    }
  }
  return {
    isPro: query.data?.isPro ?? false,
    isProLoading: query.isPending,
    // Status fetch failed: we don't know the plan. Callers must NOT show an
    // upgrade pitch on this — downgrading a paying user over a network blip
    // is worse than showing nothing.
    isProUnknown: query.isError,
    isProRefreshing: query.isFetching,
    status: query.data ?? null,
    refreshPro: () => query.refetch(),
  }
}
