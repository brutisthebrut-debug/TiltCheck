// Escape LIKE/ILIKE wildcards in user-supplied search text so "100%" matches
// the literal characters instead of acting as a pattern.
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// Page-size guardrail: the client asks, the server caps.
export function clampPageSize(limit: number | undefined | null, fallback: number): number {
  const n = limit ?? fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 200);
}
