import { useEffect, useState } from "react"
import { useUser } from "@/contexts/UserContext"
import {
  useGetUserBadges,
  getGetUserBadgesQueryKey,
  type BadgeStatus,
} from "@workspace/api-client-react"
import { BadgeReveal } from "./BadgeReveal"

const seenKey = (userId: number) => `edgeboard-badges-seen-${userId}`

function readSeen(userId: number): string[] | null {
  try {
    const raw = localStorage.getItem(seenKey(userId))
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeSeen(userId: number, ids: string[]) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify(ids))
  } catch {
    // storage full/blocked — worst case the reveal replays next visit
  }
}

/**
 * Watches the signed-in bettor's badge case and pops the reveal moment for
 * anything newly earned. The badges query is invalidated after log/settle
 * actions, so new awards surface right after the action that earned them.
 *
 * "Already seen" lives in localStorage per device; the first fetch on a fresh
 * device baselines silently instead of replaying the whole trophy shelf.
 */
export function BadgeWatcher() {
  const { activeUser } = useUser()
  const userId = activeUser?.id
  const [queue, setQueue] = useState<BadgeStatus[]>([])

  const { data: badges } = useGetUserBadges(userId ?? 0, {
    query: { enabled: !!userId, queryKey: getGetUserBadgesQueryKey(userId ?? 0) },
  })

  useEffect(() => {
    if (!badges || !userId) return
    const earned = badges.filter((b) => b.earnedAt != null)
    const earnedIds = earned.map((b) => b.id)
    const seen = readSeen(userId)
    if (seen === null) {
      writeSeen(userId, earnedIds)
      return
    }
    const fresh = earned.filter((b) => !seen.includes(b.id))
    if (fresh.length === 0) return
    writeSeen(userId, earnedIds)
    setQueue((q) => [...q, ...fresh.filter((f) => !q.some((x) => x.id === f.id))])
  }, [badges, userId])

  return (
    <BadgeReveal
      badge={queue[0] ?? null}
      onDone={() => setQueue((q) => q.slice(1))}
    />
  )
}
