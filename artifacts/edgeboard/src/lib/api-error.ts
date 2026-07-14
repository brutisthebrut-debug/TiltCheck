/**
 * Extract a human-readable message from an API error.
 *
 * The API returns errors as `{ "error": "..." }` JSON bodies, which the
 * generated client surfaces on the thrown error's `data` property. Fall back
 * to a generic message when the shape is unexpected (network failure, etc.).
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const data = (err as { data?: unknown }).data
    if (data && typeof data === "object") {
      const message = (data as { error?: unknown }).error
      if (typeof message === "string" && message.trim() !== "") {
        // Zod validation dumps are JSON arrays — too technical to show raw.
        if (!message.trimStart().startsWith("[")) {
          return message
        }
      }
    }
  }
  return fallback
}
