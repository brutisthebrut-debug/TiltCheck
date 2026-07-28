import { useGetBillingStatus, getGetBillingStatusQueryKey } from "@workspace/api-client-react"

// The public demo board never talks to /billing: the demo API doesn't mount
// billing routes, and the demo world always has multi-Crew access.
// DemoApp flips this off the same way it does odds-format server sync.
let billingServerSync = true
export function setBillingServerSync(enabled: boolean) {
  billingServerSync = enabled
}

/**
 * Server-verified multi-Crew status. The server is the only authority — this
 * hook only reads GET /billing/status.
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
