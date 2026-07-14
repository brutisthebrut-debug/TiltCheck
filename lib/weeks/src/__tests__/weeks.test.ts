import { describe, it, expect } from "vitest";
import { dayOf, addDays, mondayOf, lastCompletedWeekStart } from "../index";

describe("week math (UTC, Monday-start)", () => {
  it("formats a Date as YYYY-MM-DD (UTC)", () => {
    expect(dayOf(new Date("2026-07-14T23:59:59Z"))).toBe("2026-07-14");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-07-14", 1)).toBe("2026-07-15");
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });

  it("snaps any date to its Monday (UTC)", () => {
    expect(mondayOf("2026-07-14")).toBe("2026-07-13"); // Tuesday → Monday
    expect(mondayOf("2026-07-13")).toBe("2026-07-13"); // Monday stays
    expect(mondayOf("2026-07-12")).toBe("2026-07-06"); // Sunday belongs to prior Monday
  });

  it("last completed week is the Monday before this week's Monday", () => {
    expect(lastCompletedWeekStart("2026-07-14")).toBe("2026-07-06");
    expect(lastCompletedWeekStart("2026-07-13")).toBe("2026-07-06"); // fresh Monday: last week just ended
  });
});
