// Authoritative founder control. When FOUNDER_EMAIL is set, the account with
// that email (case-insensitive) is the board owner: it becomes founder on
// claim, is always allowed through the invite gate, and first-claim
// auto-assignment is disabled — so a stranger can never grab the founder seat
// on a fresh database by signing in first. Unset: the first account to link
// becomes founder (fine for dev, but set FOUNDER_EMAIL in production).
// Read at request time so config changes apply without a rebuild.
export function founderEmail(): string | null {
  return process.env.FOUNDER_EMAIL?.trim().toLowerCase() || null;
}

/** True when the given account email matches the configured FOUNDER_EMAIL. */
export function isConfiguredFounderEmail(email: string | null | undefined): boolean {
  const configured = founderEmail();
  return configured != null && email != null && email.trim().toLowerCase() === configured;
}
