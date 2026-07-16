import { useQueryClient } from "@tanstack/react-query"
import {
  useUpdateUser,
  getGetCurrentUserQueryKey,
  type User,
  type UpdateUserInput,
} from "@workspace/api-client-react"

/**
 * #167: the Lessons-page filters are saved on the profile so the bettor's
 * view follows them across devices. Same pattern as the odds format: change
 * applies instantly, then PATCHes the profile with an optimistic cache write
 * so an in-flight refetch can't hydrate the old value back.
 */

export type LessonsFilterPatch = Pick<
  UpdateUserInput,
  "lessonsResultFilter" | "lessonsQualityFilter" | "lessonsReasonFilter"
>

// The demo board reuses the real pages, but its "current user" is a fictional
// persona — filter choices must stay local and never PATCH the demo API.
let serverSyncEnabled = true
export function setLessonsFiltersServerSync(enabled: boolean): void {
  serverSyncEnabled = enabled
}

/** Returns a saver that persists a lessons-filter change to the profile. */
export function useSaveLessonsFilters(): (patch: LessonsFilterPatch) => void {
  const queryClient = useQueryClient()
  const updateUser = useUpdateUser()

  return (patch) => {
    if (!serverSyncEnabled) return
    const me = queryClient.getQueryData<User>(getGetCurrentUserQueryKey())
    if (!me) return
    queryClient.setQueryData(getGetCurrentUserQueryKey(), { ...me, ...patch })
    updateUser.mutate(
      { id: me.id, data: patch },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetCurrentUserQueryKey(), updated)
        },
        // On failure the filter still applies on this device for the session;
        // the profile keeps its previous saved view.
      }
    )
  }
}
