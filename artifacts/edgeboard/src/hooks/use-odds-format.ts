import { useSyncExternalStore } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useUpdateUser, getGetCurrentUserQueryKey, type User } from "@workspace/api-client-react"
import type { OddsFormat } from "@workspace/odds"

const STORAGE_KEY = "edgeboard-odds-format"
const CHANGE_EVENT = "edgeboard-odds-format-change"

function isOddsFormat(value: unknown): value is OddsFormat {
  return value === "american" || value === "decimal" || value === "fractional"
}

export function getOddsFormat(): OddsFormat {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isOddsFormat(stored)) return stored
  } catch {
    // localStorage unavailable — fall through to default
  }
  return "american"
}

/** Local-only write: updates this device and notifies listeners. */
export function setOddsFormat(format: OddsFormat): void {
  try {
    localStorage.setItem(STORAGE_KEY, format)
  } catch {
    // best-effort persistence
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

// The demo board reuses the real pages and UserProvider, but its "current
// user" is a fictional persona — the viewer's format choice must stay local
// and never PATCH the (read-only) demo API or get overwritten by it.
let serverSyncEnabled = true
export function setOddsFormatServerSync(enabled: boolean): void {
  serverSyncEnabled = enabled
}

/**
 * Hydrate the local cache from the profile's saved preference (the server is
 * the source of truth across devices). No-op when already in sync or when
 * server sync is off (demo board).
 */
export function syncOddsFormatFromServer(format: string): void {
  if (!serverSyncEnabled) return
  if (!isOddsFormat(format) || getOddsFormat() === format) return
  setOddsFormat(format)
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener("storage", callback)
  }
}

/**
 * The bettor's preferred odds format (American / Decimal / Fractional).
 * Applied instantly on this device via localStorage, and saved to the
 * profile so the choice follows the user across devices. Signed-out /
 * demo viewers only get the local behavior.
 */
export function useOddsFormat(): [OddsFormat, (format: OddsFormat) => void] {
  const format = useSyncExternalStore(subscribe, getOddsFormat, () => "american" as OddsFormat)
  const queryClient = useQueryClient()
  const updateUser = useUpdateUser()

  const setFormat = (next: OddsFormat) => {
    setOddsFormat(next)
    if (!serverSyncEnabled) return
    const me = queryClient.getQueryData<User>(getGetCurrentUserQueryKey())
    if (me && me.oddsFormat !== next) {
      // Optimistically update the cached profile so an in-flight refetch
      // can't hydrate the old preference back over the fresh choice.
      queryClient.setQueryData(getGetCurrentUserQueryKey(), { ...me, oddsFormat: next })
      updateUser.mutate(
        { id: me.id, data: { oddsFormat: next } },
        {
          onSuccess: (updated) => {
            queryClient.setQueryData(getGetCurrentUserQueryKey(), updated)
          },
          // On failure the local choice still applies on this device; the
          // profile keeps its previous preference.
        }
      )
    }
  }

  return [format, setFormat]
}
