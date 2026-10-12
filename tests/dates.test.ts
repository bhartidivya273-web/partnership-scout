import { describe, expect, it } from "vitest";
import { daysLeft, daysSinceLaunch, inWindow } from "@/lib/dates";

// Fixed clock from Builder_Pack/02_Test_Spec.md: tests must never use the real clock.
const NOW = new Date("2026-10-12T12:00:00Z");

// [launch time, in window?, daysSinceLaunch, daysLeft]
const cases: Array<[string, string | null, boolean, number | null, number | null]> = [
  ["A1 exactly now", "2026-10-12T12:00:00Z", true, 0, 7],
  ["A2 earlier today", "2026-10-12T07:01:00Z", true, 0, 7],
  ["A3 one day ago", "2026-10-11T12:00:00Z", true, 1, 6],
  ["A4 a day and a bit", "2026-10-10T20:00:00Z", true, 1, 6],
  ["A5 six days ago", "2026-10-06T00:00:00Z", true, 6, 1],
  ["A6 exactly 7 days (inclusive)", "2026-10-05T12:00:00Z", true, 7, 0],
  ["A7 one second too old", "2026-10-05T11:59:59Z", false, null, null],
  ["A8 scheduled in the future", "2026-10-12T13:00:00Z", false, null, null],
  ["A9 missing launch time", null, false, null, null],
];

describe("date rules (PRD F5, F6, F9, F9b)", () => {
  it.each(cases)("%s", (_name, launch, expectedIn, expectedSince, expectedLeft) => {
    expect(inWindow(launch, NOW)).toBe(expectedIn);
    if (expectedIn) {
      expect(daysSinceLaunch(launch as string, NOW)).toBe(expectedSince);
      expect(daysLeft(launch as string, NOW)).toBe(expectedLeft);
    }
  });

  it("treats an unreadable date as outside the window", () => {
    expect(inWindow("not a date", NOW)).toBe(false);
  });

  it("never reports negative days left", () => {
    expect(daysLeft("2026-09-01T00:00:00Z", NOW)).toBe(0);
  });
});
