import { describe, expect, it } from "vitest";
import { evidenceChecks, evidenceCount, missingInfo, responsiveness } from "@/lib/evidence";
import { normaliseWeights, PRESETS, PRIORITY_KEYS, rankByPriority, type FitInfo } from "@/lib/priority";
import { rankPool } from "@/lib/scoring";
import { classified } from "./ai-helpers";

const fit = (f: FitInfo["fit"]): FitInfo => ({ fit: f, relevance: "x" });
const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe("priority weights", () => {
  it("every preset sums to exactly 100", () => {
    for (const w of Object.values(PRESETS)) expect(sum(w)).toBe(100);
  });
  it("custom weights are rescaled to 100 and negatives or junk count as 0", () => {
    const w = normaliseWeights({ votes: 2, maker: 2, relevance: 4, momentum: -5, window: "abc", evidence: NaN });
    expect(sum(w)).toBeCloseTo(100, 8);
    expect(w).toMatchObject({ votes: 25, maker: 25, relevance: 50, momentum: 0, window: 0, evidence: 0 });
  });
  it("unusable weights fall back to the balanced default", () => {
    expect(normaliseWeights(undefined)).toEqual(PRESETS.balanced);
    expect(normaliseWeights({})).toEqual(PRESETS.balanced);
    expect(normaliseWeights({ votes: 0, maker: 0 })).toEqual(PRESETS.balanced);
  });
});

describe("priority ranking", () => {
  const a = classified("A", { upvotes: 400, makerComments: 2, daysSinceLaunch: 1, daysLeft: 6 });
  const b = classified("B", { upvotes: 120, makerComments: 15, daysSinceLaunch: 1, daysLeft: 6 });
  const c = classified("C", { upvotes: 30, makerComments: 0, daysSinceLaunch: 1, daysLeft: 6 });
  const pool = [a, b, c];

  it("the assignment's core score is untouched: B 90.0, A 69.8, C 28.6", () => {
    const r = rankByPriority(pool, new Map());
    const core = Object.fromEntries(r.map((x) => [x.id, x.core.total]));
    expect(core).toEqual({ A: 69.8, B: 90.0, C: 28.6 });
    expect(rankPool(pool).map((x) => x.score.total).sort()).toEqual(Object.values(core).sort());
  });

  it("parts add up to the total and every part is within its weight", () => {
    for (const p of rankByPriority(pool, new Map([["A", fit("strong")]]))) {
      const points = PRIORITY_KEYS.map((k) => p.priority.parts[k].points);
      expect(points.reduce((x, y) => x + y, 0)).toBeCloseTo(p.priority.total, 0);
      for (const k of PRIORITY_KEYS) expect(p.priority.parts[k].points).toBeLessThanOrEqual(p.priority.weights[k] + 1e-9);
      expect(p.priority.total).toBeGreaterThanOrEqual(0);
      expect(p.priority.total).toBeLessThanOrEqual(100);
    }
  });

  it("relevance moves the rank: a strong fit overtakes an otherwise identical weak fit", () => {
    const x = classified("X", { upvotes: 100, makerComments: 5 });
    const y = classified("Y", { upvotes: 100, makerComments: 5 });
    const r = rankByPriority([x, y], new Map([["X", fit("weak")], ["Y", fit("strong")]]));
    expect(r.map((p) => p.id)).toEqual(["Y", "X"]);
  });

  it("unrated products are neutral, between weak and partial", () => {
    const mk = (id: string) => classified(id, { upvotes: 100, makerComments: 5 });
    const r = rankByPriority([mk("W"), mk("U"), mk("P")], new Map([["W", fit("weak")], ["P", fit("partial")]]));
    expect(r.map((p) => p.id)).toEqual(["P", "U", "W"]);
  });

  it("the 'fit first' preset lets relevance beat raw popularity; 'engagement' does the opposite", () => {
    const big = classified("big", { upvotes: 900, makerComments: 40, daysSinceLaunch: 3, daysLeft: 4 });
    const niche = classified("niche", { upvotes: 300, makerComments: 10, daysSinceLaunch: 3, daysLeft: 4 });
    const fits = new Map([["big", fit("weak")], ["niche", fit("strong")]]);
    expect(rankByPriority([big, niche], fits, "fit")[0].id).toBe("niche");
    expect(rankByPriority([big, niche], fits, "engagement")[0].id).toBe("big");
  });

  it("momentum is age-adjusted: the same votes earned faster score higher", () => {
    const fast = classified("fast", { upvotes: 200, makerComments: 5, daysSinceLaunch: 0, daysLeft: 7 });
    const slow = classified("slow", { upvotes: 200, makerComments: 5, daysSinceLaunch: 6, daysLeft: 1 });
    const r = rankByPriority([fast, slow], new Map(), { momentum: 100 });
    expect(r[0].id).toBe("fast");
    expect(r[0].priority.parts.momentum.value).toBe(1);
    // log-scaled like the other signals: 7x slower is clearly lower, but not zero
    expect(r[1].priority.parts.momentum.value).toBeGreaterThan(0.5);
    expect(r[1].priority.parts.momentum.value).toBeLessThan(0.7);
  });

  it("time left in the window favours fresher launches", () => {
    const fresh = classified("fresh", { daysLeft: 7 });
    const late = classified("late", { daysLeft: 1 });
    expect(rankByPriority([late, fresh], new Map(), { window: 100 }).map((p) => p.id)).toEqual(["fresh", "late"]);
  });

  it("ties fall back to the assignment signals, then maker comments, then votes", () => {
    const t1 = classified("t1", { upvotes: 100, makerComments: 3, daysLeft: 5, daysSinceLaunch: 2 });
    const t2 = classified("t2", { upvotes: 100, makerComments: 3, daysLeft: 5, daysSinceLaunch: 2, launchedAt: "2026-10-11T00:00:00Z" });
    expect(rankByPriority([t1, t2], new Map(), { window: 100 }).map((p) => p.id)).toEqual(["t2", "t1"]); // newer first
  });

  it("is deterministic and does not change its input", () => {
    const before = JSON.stringify(pool);
    const r1 = rankByPriority(pool, new Map([["A", fit("partial")]]));
    const r2 = rankByPriority([...pool].reverse(), new Map([["A", fit("partial")]]));
    expect(r1.map((p) => [p.id, p.priority.total])).toEqual(r2.map((p) => [p.id, p.priority.total]));
    expect(JSON.stringify(pool)).toBe(before);
  });

  it("an empty pool and a single product work", () => {
    expect(rankByPriority([], new Map())).toEqual([]);
    const one = rankByPriority([classified("solo", { upvotes: 0, makerComments: 0 })], new Map());
    expect(one[0].rank).toBe(1);
    expect(one[0].priority.total).toBeGreaterThanOrEqual(0);
  });

  it("reports rank by votes and by maker comments inside the pool", () => {
    const r = Object.fromEntries(rankByPriority(pool, new Map()).map((p) => [p.id, [p.votesRank, p.makerRank]]));
    expect(r).toEqual({ A: [1, 2], B: [2, 1], C: [3, 3] });
  });
});

describe("evidence and responsiveness", () => {
  const named = classified("N", {
    websiteUrl: "https://x.example",
    description: "A description that is comfortably longer than forty characters.",
    makerComments: 4,
    founder: { label: "Iris Tu", founderSource: "named", visibleMakers: [{ name: "Iris Tu", username: "iris", headline: null, profileUrl: null, followersCount: null, twitterUsername: null, websiteUrl: null }], hiddenCount: 0, totalMakers: 1 },
  });
  it("counts five checks and only credits a fit that the AI really rated", () => {
    expect(evidenceCount(evidenceChecks(named, true))).toBe(5);
    expect(evidenceCount(evidenceChecks(named, false))).toBe(4);
    const bare = classified("B", { websiteUrl: null, description: "short", makerComments: 0 });
    expect(evidenceCount(evidenceChecks(bare, false))).toBe(0);
  });
  it("lists exactly what is missing, always including the no-email limit", () => {
    const bare = classified("B", { websiteUrl: null, description: "short", makerComments: 0 });
    const m = missingInfo(bare, false).join(" | ");
    expect(m).toContain("Founder not listed");
    expect(m).toContain("No product website");
    expect(m).toContain("very short");
    expect(m).toContain("No maker comments recorded");
    expect(m).toContain("could not be rated");
    expect(m).toContain("no email addresses");
    expect(missingInfo(named, true).join(" ")).not.toContain("Founder not listed");
  });
  it("flags a missing maker-comment count separately from a real zero", () => {
    const p = classified("F", { flags: ["maker_comments_missing"], makerComments: 0 });
    expect(missingInfo(p, true).join(" ")).toContain("did not return a maker-comment count");
  });
  it("responsiveness needs both a real count and a high standing in the pool", () => {
    expect(responsiveness(0, 5, 20).level).toBe("none");
    expect(responsiveness(1, 1, 20).level).toBe("low"); // top rank but a tiny count is not "high"
    expect(responsiveness(30, 12, 20).level).toBe("low"); // big count but low standing
    expect(responsiveness(5, 8, 20).level).toBe("moderate");
    expect(responsiveness(60, 1, 20).level).toBe("high");
  });
  it("never invents a comment-by-comment claim: notes always say 'per Product Hunt'", () => {
    for (const n of [responsiveness(1, 1, 5), responsiveness(5, 2, 5), responsiveness(60, 1, 5)]) expect(n.note).toContain("per Product Hunt");
  });
});
