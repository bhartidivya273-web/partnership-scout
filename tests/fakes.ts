// Fake Product Hunt and fake Gemini for pipeline tests: fast, deterministic, no network.
import type { GeminiFn } from "@/lib/gemini";

export const NOW = new Date("2026-10-12T12:00:00Z");

export function rawPost(i: number, over: Record<string, unknown> = {}) {
  return {
    id: String(i),
    name: `Product ${i}`,
    tagline: `Tagline ${i}`,
    description: `Description ${i}`,
    url: `https://www.producthunt.com/posts/p${i}`,
    website: `https://example.com/${i}`,
    createdAt: "2026-10-11T12:00:00Z",
    votesCount: 10 + i,
    commentsCount: 5,
    makerReplies: i % 7,
    dailyRank: (i % 9) + 1,
    weeklyRank: null,
    reviewsCount: 0,
    reviewsRating: null,
    makers: [{ id: "0", name: "[REDACTED]", username: "[REDACTED]" }],
    topics: { edges: [{ node: { name: "Task Management" } }] },
    ...over,
  };
}

/** Product Hunt that serves `total` posts 20 at a time and counts every request. */
export function fakePH(total: number, opts: { failWith?: number; makePost?: (i: number) => Record<string, unknown>; remaining?: number } = {}) {
  const calls = { n: 0 };
  const all = Array.from({ length: total }, (_, i) => (opts.makePost ?? rawPost)(i + 1));
  const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
    calls.n += 1;
    await new Promise((r) => setTimeout(r, 5)); // small delay so simultaneous callers really overlap
    if (opts.failWith) return new Response("nope", { status: opts.failWith, headers: { "x-rate-limit-reset": "600" } });
    const after = JSON.parse(String(init?.body)).variables.after;
    const start = after ? Number(after) : 0;
    const slice = all.slice(start, start + 20);
    const end = start + slice.length;
    return new Response(
      JSON.stringify({ data: { posts: { edges: slice.map((node) => ({ node })), pageInfo: { hasNextPage: end < total, endCursor: String(end) } } } }),
      { headers: { "x-rate-limit-remaining": String((opts.remaining ?? 6250) - calls.n * 100), "x-rate-limit-reset": "900" } },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** A Gemini that sorts every product into team_communication, rates a fit and writes valid, unique outreach. */
export function fakeGemini(
  opts: {
    failClassify?: boolean;
    failFit?: boolean;
    failOutreach?: boolean;
    /** Fails both fit rating and outreach (the old "angle" job). */
    failAngles?: boolean;
    categoryFor?: (id: string) => string[];
    fitFor?: (id: string) => string;
  } = {},
) {
  const calls = { classify: 0, fit: 0, outreach: 0 };
  const gen: GeminiFn = async (req) => {
    const ids = [...req.user.matchAll(/"id":"(\w+)"/g)].map((m) => m[1]);
    const names = new Map([...req.user.matchAll(/"id":"(\w+)","name":"([^"]*)"/g)].map((m) => [m[1], m[2]]));
    if (req.system.includes("sort Product Hunt products")) {
      calls.classify += 1;
      if (opts.failClassify) throw new Error("gemini down");
      return ids.map((id) => ({ id, categories: opts.categoryFor ? opts.categoryFor(id) : ["team_communication"], reason: "fits team tools" }));
    }
    if (req.system.includes("rate how well it fits as a partner")) {
      calls.fit += 1;
      if (opts.failFit || opts.failAngles) throw new Error("gemini down");
      return ids.map((id) => ({
        id,
        fit: opts.fitFor ? opts.fitFor(id) : Number(id) % 3 === 0 ? "strong" : "partial",
        relevance: `${names.get(id)} is part of how teams work, so written standups could sit beside it.`,
      }));
    }
    calls.outreach += 1;
    if (opts.failOutreach || opts.failAngles) throw new Error("gemini down");
    return ids.map((id) => ({
      id,
      connection: `${names.get(id)} is part of how teams work, so a written async standup beside it could cut a status meeting for its users.`,
      hypothesis: `An integration could post each person's written standup into ${names.get(id)}, or a joint post could show remote teams how to skip the daily call.`,
      message: `Hi, I work on an async standup tool for remote teams. ${names.get(id)} caught my eye because teams using it often still hold a daily call. My hypothesis is that written standups beside their work could replace that call for small remote teams. Would a short chat about whether your users would want that make sense? Kavya`,
      question: `How do your users keep daily progress visible today?`,
      caveat: "Check whether the product already connects to standup tools and confirm the contact is the right person.",
    }));
  };
  return { gen, calls };
}
