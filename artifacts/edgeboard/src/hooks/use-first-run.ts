import { useSyncExternalStore } from "react"

// While the post-claim first-run setup is on screen, the profile gate must
// keep rendering ClaimProfile even if a background refetch of the current
// user resolves (window focus, reconnect). Deferring query invalidation
// alone isn't enough — React Query can refetch on its own schedule.
let setupActive = false
const listeners = new Set<() => void>()

export function setFirstRunSetupActive(value: boolean) {
  if (setupActive === value) return
  setupActive = value
  listeners.forEach((l) => l())
}

export function useFirstRunSetupActive(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => setupActive,
  )
}
