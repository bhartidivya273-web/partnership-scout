import { describe, expect, it } from "vitest";
import { ageText, closesText, createLineParser, isClosingSoon, launchedText, minutesAgo, oneDecimal, safeHttpUrl, twitterUrl } from "@/lib/format";
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

describe("safe links", () => {
  it("only http and https links are ever used", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.example", "not a url", "", null, undefined]) expect(safeHttpUrl(bad as string)).toBeNull();
  });
  it("a Twitter handle becomes a link only if it is a plain handle", () => {
    expect(twitterUrl("iris_tu")).toBe("https://x.com/iris_tu");
    for (const bad of ["a b", "x/../y", "<script>", "", null, "waytoolongforahandle1"]) expect(twitterUrl(bad as string)).toBeNull();
  });
  it("age text is plain", () => {
    expect([0, 1, 59, 60, 125, 60 * 49].map(ageText)).toEqual(["less than a minute", "1 min", "59 min", "1 hour", "2 hours", "2 days"]);
  });
});
