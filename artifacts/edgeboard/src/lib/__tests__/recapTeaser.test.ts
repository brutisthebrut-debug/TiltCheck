import { describe, it, expect } from "vitest"
import {
  addDays,
  mondayOf,
  latestRecapWeekStart,
  RECAP_SEEN_KEY,
  isRecapUnseen,
  markRecapSeen,
} from "../recapTeaser"

function fakeStore(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe("week math (mirrors the server)", () => {
  it("snaps any date to its Monday (UTC)", () => {
    expect(mondayOf("2026-07-14")).toBe("2026-07-13") // Tuesday → Monday
    expect(mondayOf("2026-07-13")).toBe("2026-07-13") // Monday stays
    expect(mondayOf("2026-07-12")).toBe("2026-07-06") // Sunday belongs to prior Monday
  })

  it("latest recap week is the Monday before this week's Monday", () => {
    expect(latestRecapWeekStart("2026-07-14")).toBe("2026-07-06")
    expect(latestRecapWeekStart("2026-07-13")).toBe("2026-07-06") // fresh Monday: last week just ended
    expect(addDays("2026-07-06", 7)).toBe("2026-07-13")
  })
})

describe("dashboard teaser lifecycle", () => {
  const USER = 1

  it("shows for a new week, hides once the recap is opened, reappears the following week", () => {
    const store = fakeStore()
    const week1 = "2026-07-14" // Tuesday — recap week is 2026-07-06

    // New week, never opened → teaser shows
    expect(isRecapUnseen(USER, week1, store)).toBe(true)

    // Opening the recap marks this week's as seen → teaser hides
    markRecapSeen(USER, week1, store)
    expect(isRecapUnseen(USER, week1, store)).toBe(false)

    // Still hidden for the rest of that week
    expect(isRecapUnseen(USER, "2026-07-19", store)).toBe(false) // Sunday, same week

    // Next Monday a fresh recap week exists → teaser reappears
    const week2 = "2026-07-20"
    expect(isRecapUnseen(USER, week2, store)).toBe(true)

    // ...until that one is opened too
    markRecapSeen(USER, week2, store)
    expect(isRecapUnseen(USER, week2, store)).toBe(false)
  })

  it("tracks seen state per user", () => {
    const store = fakeStore()
    markRecapSeen(1, "2026-07-14", store)
    expect(isRecapUnseen(1, "2026-07-14", store)).toBe(false)
    expect(isRecapUnseen(2, "2026-07-14", store)).toBe(true)
    expect(RECAP_SEEN_KEY(1)).not.toBe(RECAP_SEEN_KEY(2))
  })
})
