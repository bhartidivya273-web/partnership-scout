import { describe, expect, it } from "vitest";
import { fetchFeaturedPosts, ProductHuntError } from "@/lib/producthunt";
import { buildPool } from "@/lib/pool";

const NOW = new Date("2026-10-12T12:00:00Z");

function rawPost(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: String(i),
    name: `Product ${i}`,
    tagline: `Tagline ${i}`,
    description: `Description ${i}`,
    url: `https://www.producthunt.com/posts/p${i}`,
    website: `https://example.com/${i}`,
    createdAt: "2026-10-11T12:00:00Z",
    votesCount: 100 + i,
    commentsCount: 10,
    makerReplies: 3,
    makers: [{ id: "0", name: "[REDACTED]", username: "[REDACTED]" }],
    topics: { edges: [{ node: { name: "Task Management" } }] },
    ...overrides,
  };
}

/** Fake Product Hunt: serves `total` posts, `perPage` at a time, and counts the requests. */
function fakeApi(total: number, perPage = 20) {
  const calls = { n: 0 };
  const all = Array.from({ length: total }, (_, i) => rawPost(i + 1));
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    calls.n += 1;
    const vars = JSON.parse(String(init?.body)).variables;
    const start = vars.after ? Number(vars.after) : 0;
    const slice = all.slice(start, start + perPage);
    const end = start + slice.length;
    return new Response(
      JSON.stringify({
        data: {
          posts: {
            edges: slice.map((node) => ({ node })),
            pageInfo: { hasNextPage: end < total, endCursor: String(end) },
          },
        },
      }),
      { status: 200, headers: { "x-rate-limit-remaining": String(6250 - calls.n * 100), "x-rate-limit-reset": "900" } },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("Product Hunt paging (test spec, paging checks)", () => {
  it("pages 251 posts in 13 requests, the last one returning 11", async () => {
    const { fetchImpl, calls } = fakeApi(251);
    const r = await fetchFeaturedPosts({ token: "t", now: NOW, fetchImpl });
    expect(r.posts).toHaveLength(251);
    expect(r.pages).toBe(13);
    expect(calls.n).toBe(13);
    expect(r.partial).toBe(false);
    expect(r.quotaRemaining).toBe(6250 - 13 * 100);
  });

  it("stops at the safety cap of 20 pages", async () => {
    const { fetchImpl, calls } = fakeApi(1000);
    const r = await fetchFeaturedPosts({ token: "t", now: NOW, fetchImpl });
    expect(calls.n).toBe(20);
    expect(r.pages).toBe(20);
    expect(r.posts).toHaveLength(400);
  });

  it("asks for featured posts with an explicit 7-day start", async () => {
    let body: { variables: Record<string, unknown> } | undefined;
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: { posts: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    }) as typeof fetch;
    await fetchFeaturedPosts({ token: "t", now: NOW, fetchImpl });
    expect(body?.variables.postedAfter).toBe("2026-10-05T12:00:00.000Z");
    expect(body?.variables.first).toBe(20);
  });

  it("E12: retries a failing page once, then returns what it has with partial = true", async () => {
    const { fetchImpl: good } = fakeApi(60);
    let calls = 0;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls += 1;
      const after = JSON.parse(String(init?.body)).variables.after;
      if (after === "20") return new Response("boom", { status: 502 }); // page 2 always fails
      return good(url as RequestInfo, init);
    }) as typeof fetch;
    const r = await fetchFeaturedPosts({ token: "t", now: NOW, fetchImpl });
    expect(r.posts).toHaveLength(20);
    expect(r.partial).toBe(true);
    expect(calls).toBe(1 + 2); // page 1 once, failing page 2 twice (one retry)
  });

  it("E5: a rejected token is reported clearly, with no retry and no token in the message", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("unauthorized", { status: 401 });
    }) as typeof fetch;
    const err = await fetchFeaturedPosts({ token: "super-secret", now: NOW, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ProductHuntError);
    expect(err.kind).toBe("token");
    expect(err.message).not.toContain("super-secret");
    expect(calls).toBe(1);
  });

  it("E5: a missing token fails before any request", async () => {
    const { fetchImpl, calls } = fakeApi(5);
    const err = await fetchFeaturedPosts({ token: "", now: NOW, fetchImpl }).catch((e) => e);
    expect(err.kind).toBe("token");
    expect(calls.n).toBe(0);
  });

  it("E3: a 429 is not retried (retrying would only burn quota)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("slow down", { status: 429, headers: { "x-rate-limit-remaining": "0", "x-rate-limit-reset": "600" } });
    }) as typeof fetch;
    const err = await fetchFeaturedPosts({ token: "t", now: NOW, fetchImpl }).catch((e) => e);
    expect(err.kind).toBe("rate_limited");
    expect(err.resetSeconds).toBe(600);
    expect(calls).toBe(1);
  });

  it("a failure on the very first page (after one retry) is an error, not an empty list", async () => {
    const fetchImpl = (async () => new Response("down", { status: 503 })) as typeof fetch;
    const err = await fetchFeaturedPosts({ token: "t", now: NOW, fetchImpl }).catch((e) => e);
    expect(err.kind).toBe("unavailable");
  });
});

describe("candidate pool (PRD F6, F8, F10 to F13, section 10)", () => {
  it("drops scheduled, undated and too-old posts, and de-duplicates by id", () => {
    const posts = [
      rawPost(1),
      rawPost(1), // duplicate
      rawPost(2, { createdAt: "2026-10-12T13:00:00Z" }), // future
      rawPost(3, { createdAt: null }),
      rawPost(4, { createdAt: "2026-10-05T11:59:59Z" }), // 7 days and 1 second ago
      rawPost(5, { createdAt: "2026-10-05T12:00:00Z" }), // boundary, kept
    ];
    const pool = buildPool(posts, NOW);
    expect(pool.map((p) => p.id)).toEqual(["1", "5"]);
  });

  it("fills every field the page needs", () => {
    const [p] = buildPool([rawPost(7)], NOW);
    expect(p).toMatchObject({
      id: "7",
      name: "Product 7",
      tagline: "Tagline 7",
      upvotes: 107,
      makerComments: 3,
      totalComments: 10,
      daysSinceLaunch: 1,
      daysLeft: 6,
      topics: ["Task Management"],
    });
    expect(p.founder.label).toBe("Founder not listed");
    // The sample post's only maker is hidden, so exactly this flag is expected and no other.
    expect(p.flags).toEqual(["founder_hidden"]);
  });

  it("makerComments comes from makerReplies, never from commentsCount", () => {
    const [p] = buildPool([rawPost(1, { makerReplies: 0, commentsCount: 99 })], NOW);
    expect(p.makerComments).toBe(0);
  });

  it("E13: a missing makerReplies counts as 0 and is flagged", () => {
    const [p] = buildPool([rawPost(1, { makerReplies: undefined })], NOW);
    expect(p.makerComments).toBe(0);
    expect(p.flags).toContain("maker_comments_missing");
  });

  it("E14: a missing website leaves the link out but keeps the row", () => {
    const [p] = buildPool([rawPost(1, { website: null })], NOW);
    expect(p.websiteUrl).toBeNull();
  });

  it("flags founder_hidden when no maker is visible", () => {
    const [p] = buildPool([rawPost(1)], NOW);
    expect(p.flags).toContain("founder_hidden");
  });

  it("missing votes count as 0 and missing topics as an empty list", () => {
    const [p] = buildPool([rawPost(1, { votesCount: null, topics: null })], NOW);
    expect(p.upvotes).toBe(0);
    expect(p.topics).toEqual([]);
  });

  it("S1: only genuine Product Hunt launches enter the pool (synthetic or foreign URLs are dropped)", () => {
    const pool = buildPool(
      [
        rawPost(1),
        rawPost(2, { url: "https://example.com/fake-launch" }),
        rawPost(3, { url: "http://www.producthunt.com/posts/insecure" }),
        rawPost(4, { url: "https://producthunt.com.evil.example/posts/x" }),
        rawPost(5, { url: null }),
        rawPost(6, { url: "https://www.producthunt.com/products/real-one?utm_source=x" }),
      ],
      NOW,
    );
    expect(pool.map((p) => p.id)).toEqual(["1", "6"]);
  });

  it("carries Product Hunt rank and review evidence, and leaves missing values empty instead of inventing them", () => {
    const [a, b] = buildPool(
      [rawPost(1, { dailyRank: 4, weeklyRank: 19, reviewsCount: 7, reviewsRating: 4.6667 }), rawPost(2, { dailyRank: 0, reviewsCount: 0, reviewsRating: 5 })],
      NOW,
    );
    expect(a).toMatchObject({ dailyRank: 4, weeklyRank: 19, reviewsCount: 7, reviewsRating: 4.7 });
    expect(b).toMatchObject({ dailyRank: null, weeklyRank: null, reviewsCount: 0, reviewsRating: null });
  });

  it("maker details come only from visible makers, with a clean profile link and follower count", () => {
    const [p] = buildPool(
      [
        rawPost(1, {
          makers: [
            { id: "0", name: "[REDACTED]", username: "[REDACTED]", url: "[REDACTED]", followersCount: 260 },
            { id: "42", name: "Iris Tu", username: "iris_tu", headline: "Builder", url: "https://www.producthunt.com/@iris_tu?utm_source=api&utm_medium=x", followersCount: 31, twitterUsername: "iris", websiteUrl: "https://iris.example" },
          ],
        }),
      ],
      NOW,
    );
    expect(p.founder.visibleMakers).toEqual([
      { name: "Iris Tu", username: "iris_tu", headline: "Builder", profileUrl: "https://www.producthunt.com/@iris_tu", followersCount: 31, twitterUsername: "iris", websiteUrl: "https://iris.example" },
    ]);
    expect(JSON.stringify(p.founder)).not.toContain("260"); // a hidden maker's follower count is never attributed
  });

  it("rejects profile links that are not on Product Hunt", () => {
    const [p] = buildPool([rawPost(1, { makers: [{ id: "1", name: "A B", username: "ab", url: "https://evil.example/@ab" }] })], NOW);
    expect(p.founder.visibleMakers[0].profileUrl).toBeNull();
  });
});
