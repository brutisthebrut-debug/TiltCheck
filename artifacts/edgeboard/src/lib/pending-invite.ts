// A crew invite code captured from a /join/CODE link. It has to survive the
// full Clerk sign-up round-trip (redirects, OAuth hops) so localStorage is
// the only home that works — sessionStorage dies on some OAuth flows.

const PENDING_INVITE_KEY = "edgeboard-pending-invite-code"

export function getPendingInviteCode(): string | null {
  try {
    const value = localStorage.getItem(PENDING_INVITE_KEY)
    return value && value.trim() ? value : null
  } catch {
    return null
  }
}

export function setPendingInviteCode(code: string) {
  const trimmed = code.trim().toUpperCase().slice(0, 16)
  if (!trimmed) return
  try {
    localStorage.setItem(PENDING_INVITE_KEY, trimmed)
  } catch {
    // storage unavailable — the bettor can still type the code by hand
  }
}

export function clearPendingInviteCode() {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY)
  } catch {
    // nothing to clear
  }
}
