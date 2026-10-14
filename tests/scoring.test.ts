import { afterEach, describe, expect, it, vi } from "vitest";
import { normaliseWeights, rankPool } from "@/lib/scoring";
import type { Product } from "@/lib/types";

function product(id: string, upvotes: number, makerComments: number, launchedAt = "2026-10-10T00:00:00Z"): Product {
  return {
    id,
    name: id,
    tagline: "",
    description: "",
    productHuntUrl: "",
    websiteUrl: null,
    launchedAt,
    daysSinceLaunch: 0,
    daysLeft: 7,
    upvotes,
    totalComments: 0,
    makerComments,
    dailyRank: null,
    weeklyRank: null,
    reviewsCount: 0,
    reviewsRating: null,
    founder: { label: "Founder not listed", founderSource: "none", visibleMakers: [], hiddenCount: 0, totalMakers: 0 },
    topics: [],
    flags: [],
  };
}

// The worked example from PRD Section 8.
const pool = () => [product("A", 400, 2), product("B", 120, 15), product("C", 30, 0)];
const byId = (r: ReturnType<typeof rankPool>) => Object.fromEntries(r.map((x) => [x.id, x]));
const order = (r: ReturnType<typeof rankPool>) => r.map((x) => x.id).join("");

afterEach(() => vi.unstubAllGlobals());

describe("scoring (PRD Section 8, test spec section B)", () => {
  it("B1: 50/50 gives A 69.8, B 90.0, C 28.6, order B, A, C", () => {
    const r = rankPool(pool());
    const s = byId(r);
    expect(s.A.score.total).toBe(69.8);
    expect(s.B.score.total).toBe(90.0);
    expect(s.C.score.total).toBe(28.6);
    expect(order(r)).toBe("BAC");
    expect(s.A.score.votesPart).toBeCloseTo(1.0, 3);
    expect(s.A.score.makerPart).toBeCloseTo(0.396, 3);
    expect(s.B.score.votesPart).toBeCloseTo(0.8, 3);
    expect(s.B.score.makerPart).toBeCloseTo(1.0, 3);
    expect(s.C.score.votesPart).toBeCloseTo(0.573, 3);
    expect(s.C.score.makerPart).toBe(0);
  });

  it("B2: weights 70/30 give A 81.9, B 86.0, C 40.1, order B, A, C", () => {
    const r = rankPool(pool(), { votes: 7, maker: 3 });
    const s = byId(r);
    expect([s.A.score.total, s.B.score.total, s.C.score.total]).toEqual([81.9, 86.0, 40.1]);
    expect(order(r)).toBe("BAC");
  });

  it("B3: votes only gives A 100.0, B 80.0, C 57.3, order A, B, C", () => {
    const r = rankPool(pool(), { votes: 100, maker: 0 });
    const s = byId(r);
    expect([s.A.score.total, s.B.score.total, s.C.score.total]).toEqual([100.0, 80.0, 57.3]);
    expect(order(r)).toBe("ABC");
  });

  it("B4: maker comments only gives A 39.6, B 100.0, C 0.0, order B, A, C", () => {
    const r = rankPool(pool(), { votes: 0, maker: 100 });
    const s = byId(r);
    expect([s.A.score.total, s.B.score.total, s.C.score.total]).toEqual([39.6, 100.0, 0.0]);
    expect(order(r)).toBe("BAC");
  });

  it("B5: both sliders at 0 fall back to 50/50", () => {
    expect(normaliseWeights({ votes: 0, maker: 0 })).toEqual({ votes: 0.5, maker: 0.5 });
    expect(order(rankPool(pool(), { votes: 0, maker: 0 }))).toBe("BAC");
  });

  it("weights are normalised so they always sum to 1", () => {
    const w = normaliseWeights({ votes: 7, maker: 3 });
    expect(w.votes + w.maker).toBeCloseTo(1, 10);
    expect(w.votes).toBeCloseTo(0.7, 10);
  });

  it("negative or non-numeric weights are treated as 0, then default if both are 0", () => {
    expect(normaliseWeights({ votes: -5, maker: Number.NaN })).toEqual({ votes: 0.5, maker: 0.5 });
    expect(normaliseWeights({ votes: -5, maker: 2 })).toEqual({ votes: 0, maker: 1 });
  });

  it("B6: a single product with 10 votes and 0 maker comments scores 50.0", () => {
    expect(rankPool([product("X", 10, 0)])[0].score.total).toBe(50.0);
  });

  it("B7: a single product with 10 votes and 5 maker comments scores 100.0", () => {
    expect(rankPool([product("X", 10, 5)])[0].score.total).toBe(100.0);
  });

  it("B8: no maker comments anywhere gives maker part 0 and scores 50.0 and 30.5", () => {
    const r = rankPool([product("hi", 50, 0), product("lo", 10, 0)]);
    const s = byId(r);
    expect(s.hi.score.total).toBe(50.0);
    expect(s.lo.score.total).toBe(30.5);
    expect(s.hi.score.makerPart).toBe(0);
    expect(s.lo.score.makerPart).toBe(0);
  });

  it("B9: all zeros gives 0.0 for everyone, ordered by the tie-breakers (newer first)", () => {
    const r = rankPool([
      product("old", 0, 0, "2026-10-08T00:00:00Z"),
      product("new", 0, 0, "2026-10-11T00:00:00Z"),
    ]);
    expect(r.map((x) => x.score.total)).toEqual([0, 0]);
    expect(order(r)).toBe("newold");
  });

  it("B10: equal scores are ordered by maker comments, then votes, then newer launch", () => {
    // Votes only, so equal votes mean equal scores; the tie-breakers then decide.
    const r = rankPool(
      [
        product("fewer-maker", 100, 1, "2026-10-11T00:00:00Z"),
        product("more-maker", 100, 5, "2026-10-09T00:00:00Z"),
      ],
      { votes: 100, maker: 0 },
    );
    expect(order(r)).toBe("more-makerfewer-maker");

    const r2 = rankPool(
      [product("older", 100, 3, "2026-10-09T00:00:00Z"), product("newer", 100, 3, "2026-10-11T00:00:00Z")],
      { votes: 100, maker: 0 },
    );
    expect(order(r2)).toBe("newerolder");
  });

  it("B10b: votes break the tie after maker comments when scores are equal", () => {
    // Maker comments only: both have 4, so equal score and equal maker comments; more votes first.
    const r = rankPool([product("low", 10, 4), product("high", 500, 4)], { votes: 0, maker: 100 });
    expect(order(r)).toBe("highlow");
  });

  it("B11: very large numbers do not overflow and stay within 0 to 100", () => {
    const r = rankPool([product("big", 1_000_000, 50_000), product("small", 1, 0)]);
    for (const p of r) {
      expect(p.score.total).toBeGreaterThanOrEqual(0);
      expect(p.score.total).toBeLessThanOrEqual(100);
    }
    expect(r[0].id).toBe("big");
  });

  it("B12: re-ranking with new weights makes no Product Hunt request", () => {
    const spy = vi.fn(() => {
      throw new Error("network must not be used");
    });
    vi.stubGlobal("fetch", spy);
    rankPool(pool(), { votes: 3, maker: 7 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("B13: scores are always 0 to 100 with one decimal, and ranks run 1, 2, 3...", () => {
    const r = rankPool(pool());
    for (const p of r) {
      expect(p.score.total).toBeGreaterThanOrEqual(0);
      expect(p.score.total).toBeLessThanOrEqual(100);
      expect(Math.round(p.score.total * 10) / 10).toBe(p.score.total);
    }
    expect(r.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it("an empty pool gives an empty list", () => {
    expect(rankPool([])).toEqual([]);
  });

  it("does not change the products it was given", () => {
    const input = pool();
    const copy = JSON.stringify(input);
    rankPool(input);
    expect(JSON.stringify(input)).toBe(copy);
  });

  it("scores are relative to the pool: the same product scores differently in another pool", () => {
    const alone = rankPool([product("A", 400, 2)])[0].score.total;
    const withB = byId(rankPool(pool())).A.score.total;
    expect(alone).not.toBe(withB);
  });
});
