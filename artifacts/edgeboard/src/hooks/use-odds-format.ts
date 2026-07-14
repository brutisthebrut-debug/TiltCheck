import { useSyncExternalStore } from "react"
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

export function setOddsFormat(format: OddsFormat): void {
  try {
    localStorage.setItem(STORAGE_KEY, format)
  } catch {
    // best-effort persistence
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
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
 * Persisted in localStorage and kept in sync across components and tabs.
 */
export function useOddsFormat(): [OddsFormat, (format: OddsFormat) => void] {
  const format = useSyncExternalStore(subscribe, getOddsFormat, () => "american" as OddsFormat)
  return [format, setOddsFormat]
}
