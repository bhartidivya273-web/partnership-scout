import { describe, expect, it } from "vitest";
import { breakdownParts, closesText, createLineParser, isClosingSoon, launchedText, minutesAgo, oneDecimal, sortRows } from "@/lib/format";
import { COPY } from "@/lib/copy";

describe("page text rules (UI spec)", () => {
  it("launched text: today, 1 day, many days", () => {
    expect(launchedText(0)).toBe("Launched today");
    expect(launchedText(1)).toBe("Launched 1 day ago");
    expect(launchedText(3)).toBe("Launched 3 days ago");
  });
  it("closes text: today, 1 day, many days", () => {
    expect(closesText(0)).toBe("Closes today");
    expect(closesText(1)).toBe("Closes in 1 day");
    expect(closesText(5)).toBe("Closes in 5 days");
  });
  it("closing soon means 2 days or fewer", () => {
    expect([0, 1, 2, 3, 7].map(isClosingSoon)).toEqual([true, true, true, false, false]);
  });
  it("minutes ago never goes negative", () => {
    expect(minutesAgo("2026-10-12T12:00:00Z", new Date("2026-10-12T12:07:30Z"))).toBe(7);
    expect(minutesAgo("2026-10-12T12:00:00Z", new Date("2026-10-12T11:00:00Z"))).toBe(0);
  });
  it("one decimal for scores", () => {
    expect(oneDecimal(90)).toBe("90.0");
    expect(oneDecimal(69.84)).toBe("69.8");
  });
  it("the fixed labels from CLAUDE.md are used exactly", () => {
    expect(COPY.METRIC_VOTES).toBe("Votes (Product Hunt score)");
    expect(COPY.METRIC_MAKER).toBe("Maker comments (per Product Hunt)");
  });
  it("no copy line contains the text [REDACTED]", () => {
    expect(JSON.stringify(COPY).toUpperCase()).not.toContain("REDACTED");
  });
});

describe("score breakdown", () => {
  it("the two parts add up to the score (B: 40.0 + 50.0 = 90.0)", () => {
    const p = breakdownParts({ votesPart: 0.8, makerPart: 1 }, { votes: 0.5, maker: 0.5 });
    expect(p.votes).toBeCloseTo(40, 5);
    expect(p.maker).toBeCloseTo(50, 5);
  });
});

describe("sorting the rows on screen", () => {
  const rows = [
    { rank: 1, daysLeft: 6, daysSinceLaunch: 1 },
    { rank: 2, daysLeft: 1, daysSinceLaunch: 6 },
    { rank: 3, daysLeft: 3, daysSinceLaunch: 0 },
  ];
  it("highest score keeps rank order", () => expect(sortRows(rows, "score").map((r) => r.rank)).toEqual([1, 2, 3]));
  it("closing soon puts the fewest days left first", () => expect(sortRows(rows, "closing").map((r) => r.rank)).toEqual([2, 3, 1]));
  it("newest puts the most recent launch first", () => expect(sortRows(rows, "newest").map((r) => r.rank)).toEqual([3, 1, 2]));
  it("ranks themselves never change when sorting", () => expect(sortRows(rows, "closing").map((r) => r.rank).sort()).toEqual([1, 2, 3]));
  it("does not change the original list", () => {
    const before = JSON.stringify(rows);
    sortRows(rows, "closing");
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("stream line parser", () => {
  it("handles lines split across chunks and a last line with no newline", () => {
    const lines: string[] = [];
    const p = createLineParser((l) => lines.push(l));
    p.push('{"a":1}\n{"b"');
    p.push(':2}\n\n{"c":3}');
    p.end();
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});

import { groupByFit, summaryCounts } from "@/lib/format";

describe("grouping by fit", () => {
  const rows = [
    { id: "a", rank: 1, fit: "weak" as const, daysLeft: 1 },
    { id: "b", rank: 2, fit: "strong" as const, daysLeft: 5 },
    { id: "c", rank: 3, fit: null, daysLeft: 6 },
    { id: "d", rank: 4, fit: "strong" as const, daysLeft: 2 },
  ];
  it("puts strong first, then partial, weak, unrated, and skips empty groups", () => {
    expect(groupByFit(rows).map((g) => [g.fit, g.rows.map((r) => r.id)])).toEqual([
      ["strong", ["b", "d"]],
      ["weak", ["a"]],
      [null, ["c"]],
    ]);
  });
  it("keeps the order it was given inside each group (so sorting still applies)", () => {
    expect(groupByFit([rows[3], rows[1]])[0].rows.map((r) => r.id)).toEqual(["d", "b"]);
  });
  it("counts fits and closing-soon windows for the summary", () => {
    expect(summaryCounts(rows)).toEqual({ strong: 2, partial: 0, weak: 1, unrated: 1, closing: 2 });
  });
});
