import type { ResultItem } from "@/lib/result";

// A complete result row with sensible defaults, for tests that need one.
export function item(id: string, over: Partial<ResultItem> = {}): ResultItem {
  return {
    rank: Number(id),
    id,
    name: `P${id}`,
    tagline: "t",
    productHuntUrl: "https://www.producthunt.com/products/x",
    websiteUrl: null,
    founder: { label: "Iris", founderSource: "named", hiddenCount: 0, totalMakers: 1, makers: [] },
    upvotes: 100,
    makerComments: 5,
    daysSinceLaunch: 2,
    daysLeft: 5,
    launchedAt: "2026-10-12T00:00:00Z",
    phRank: { daily: null, weekly: null },
    reviews: { count: 0, rating: null },
    categories: ["team_communication"],
    categorySource: "gemini",
    fit: "partial",
    relevance: "r",
    priority: { total: 50, parts: { votes: p(), maker: p(), momentum: p(), relevance: p(0.6), window: p(), evidence: p() } },
    core: { votesPart: 0.5, makerPart: 0.5, total: 50 },
    votesRank: 1,
    makerRank: 1,
    evidence: { checks: [], count: 3, total: 5 },
    responsiveness: { level: "low", note: "n" },
    missing: [],
    why: [],
    outreach: { connection: "c", hypothesis: "h", message: "m", question: "q?", caveat: "v", source: "gemini" },
    ...over,
  } as ResultItem;
}
export function p(value = 0.5) {
  return { value, weight: 10, points: value * 10 };
}
