import { describe, it, expect } from "vitest"
import { addDays, mondayOf, latestRecapWeekStart, isRecapUnseen } from "../recapTeaser"

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

describe("dashboard teaser lifecycle (server-stored seen week)", () => {
  it("shows for a new week, hides once seen, reappears the following week", () => {
    const week1 = "2026-07-14" // Tuesday — recap week is 2026-07-06

    // Never opened → teaser shows
    expect(isRecapUnseen(null, week1)).toBe(true)
    expect(isRecapUnseen(undefined, week1)).toBe(true)

    // Server recorded this week's recap as seen → teaser hides
    const seen = latestRecapWeekStart(week1)
    expect(isRecapUnseen(seen, week1)).toBe(false)

    // Still hidden for the rest of that week
    expect(isRecapUnseen(seen, "2026-07-19")).toBe(false) // Sunday, same week

    // Next Monday a fresh recap week exists → teaser reappears
    const week2 = "2026-07-20"
    expect(isRecapUnseen(seen, week2)).toBe(true)

    // ...until that one is recorded seen too
    expect(isRecapUnseen(latestRecapWeekStart(week2), week2)).toBe(false)
  })

  it("stale or malformed stored weeks count as unseen (teaser falls back to showing)", () => {
    expect(isRecapUnseen("2020-01-06", "2026-07-14")).toBe(true)
    expect(isRecapUnseen("not-a-date", "2026-07-14")).toBe(true)
  })
})
