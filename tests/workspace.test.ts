import { describe, expect, it } from "vitest";
import type { Decision } from "@/lib/decisions";
import type { ResultItem } from "@/lib/result";
import { filterItems, groupByFit, hasActiveFilters, NO_FILTERS, recommendedAction, sortItems, summaryCounts } from "@/lib/workspace";

import { item, p } from "./items";
const dec = (status: Decision["status"]): Decision => ({ productId: "x", name: "n", url: "u", status, note: "", updatedAt: "" });
const ids = (xs: ResultItem[]) => xs.map((x) => x.id).join(",");

const rows = [
  item("1", { upvotes: 50, makerComments: 20, daysSinceLaunch: 6, daysLeft: 1, fit: "weak", categories: ["developer_productivity"], evidence: { checks: [], count: 5, total: 5 } }),
  item("2", { upvotes: 400, makerComments: 2, daysSinceLaunch: 0, daysLeft: 7, fit: "strong", categories: ["project_management", "team_communication"], evidence: { checks: [], count: 2, total: 5 } }),
  item("3", { upvotes: 120, makerComments: 9, daysSinceLaunch: 3, daysLeft: 4, fit: null, evidence: { checks: [], count: 3, total: 5 } }),
  item("4", { upvotes: 120, makerComments: 9, daysSinceLaunch: 3, daysLeft: 4, fit: "strong", priority: { total: 1, parts: { ...item("4").priority.parts, relevance: p(1) } }, evidence: { checks: [], count: 4, total: 5 } }),
];

describe("sorting (every mode changes the order, ranks never change)", () => {
  it("priority keeps rank order", () => expect(ids(sortItems(rows, "priority"))).toBe("1,2,3,4"));
  it("relevance puts strong fits first, then partial, weak, unrated", () => expect(ids(sortItems(rows, "relevance"))).toBe("4,2,1,3"));
  it("upvotes sorts by votes, ties by rank", () => expect(ids(sortItems(rows, "votes"))).toBe("2,3,4,1"));
  it("maker engagement sorts by maker comments", () => expect(ids(sortItems(rows, "maker"))).toBe("1,3,4,2"));
  it("most recent launch first", () => expect(ids(sortItems(rows, "newest"))).toBe("2,3,4,1"));
  it("closing soon puts the fewest days left first", () => expect(ids(sortItems(rows, "closing"))).toBe("1,3,4,2"));
  it("does not mutate the input or change any rank", () => {
    const before = JSON.stringify(rows);
    const sorted = sortItems(rows, "votes");
    expect(JSON.stringify(rows)).toBe(before);
    expect(sorted.map((r) => r.rank).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("filtering (each filter has a real effect)", () => {
  const none = {};
  it("no filters keeps everything", () => {
    expect(filterItems(rows, NO_FILTERS, none)).toHaveLength(4);
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
  });
  it("by category", () => {
    expect(ids(filterItems(rows, { ...NO_FILTERS, category: "developer_productivity" }, none))).toBe("1");
    expect(ids(filterItems(rows, { ...NO_FILTERS, category: "project_management" }, none))).toBe("2");
    expect(ids(filterItems(rows, { ...NO_FILTERS, category: "team_communication" }, none))).toBe("2,3,4");
  });
  it("by launch age", () => {
    expect(ids(filterItems(rows, { ...NO_FILTERS, age: "1" }, none))).toBe("2");
    expect(ids(filterItems(rows, { ...NO_FILTERS, age: "3" }, none))).toBe("2,3,4");
  });
  it("by minimum evidence", () => {
    expect(ids(filterItems(rows, { ...NO_FILTERS, evidence: "3" }, none))).toBe("1,3,4");
    expect(ids(filterItems(rows, { ...NO_FILTERS, evidence: "5" }, none))).toBe("1");
  });
  it("by decision status", () => {
    const d = { "2": dec("shortlisted"), "3": dec("contacted") };
    expect(ids(filterItems(rows, { ...NO_FILTERS, status: "shortlisted" }, d))).toBe("2");
    expect(ids(filterItems(rows, { ...NO_FILTERS, status: "contacted" }, d))).toBe("3");
    expect(ids(filterItems(rows, { ...NO_FILTERS, status: "new" }, d))).toBe("1,4");
  });
  it("filters combine", () => {
    expect(ids(filterItems(rows, { ...NO_FILTERS, category: "team_communication", age: "3", evidence: "3" }, none))).toBe("3,4");
    expect(hasActiveFilters({ ...NO_FILTERS, age: "3" })).toBe(true);
  });
});

describe("grouping, summary and recommended action", () => {
  it("groups strong, partial, weak, unrated in that order and skips empty groups", () => {
    expect(groupByFit(rows).map((g) => [g.fit, ids(g.items)])).toEqual([["strong", "2,4"], ["weak", "1"], [null, "3"]]);
  });
  it("counts fits, closing soon and decisions", () => {
    expect(summaryCounts(rows, { "2": dec("shortlisted"), "1": dec("contacted") })).toEqual({ strong: 2, partial: 0, weak: 1, unrated: 1, closing: 1, shortlisted: 1, contacted: 1 });
  });
  it("recommends from fit, time left and founder knowledge", () => {
    expect(recommendedAction(item("a", { fit: "strong", daysLeft: 6 }))).toMatchObject({ tone: "go", label: expect.stringContaining("strong fit, 6 days left") });
    expect(recommendedAction(item("a", { fit: "strong", daysLeft: 1 })).tone).toBe("soon");
    expect(recommendedAction(item("a", { fit: "partial", daysLeft: 5 })).tone).toBe("maybe");
    expect(recommendedAction(item("a", { fit: "weak" })).tone).toBe("low");
    expect(recommendedAction(item("a", { fit: null })).tone).toBe("check");
    expect(recommendedAction(item("a", { fit: "strong", daysLeft: 0 })).label).toContain("window closes today");
    const hidden = item("a", { fit: "strong", daysLeft: 6, founder: { label: "Founder not listed", founderSource: "none", hiddenCount: 2, totalMakers: 2, makers: [] } });
    expect(recommendedAction(hidden).label).toContain("Find the maker on the product page first");
  });
});
