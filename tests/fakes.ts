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

/** A Gemini that sorts every product into team_communication and writes a valid, unique angle. */
export function fakeGemini(opts: { failClassify?: boolean; failAngles?: boolean; categoryFor?: (id: string) => string[] } = {}) {
  const calls = { classify: 0, angles: 0 };
  const gen: GeminiFn = async (req) => {
    const ids = [...req.user.matchAll(/"id":"(\w+)"/g)].map((m) => m[1]);
    const names = new Map([...req.user.matchAll(/"id":"(\w+)","name":"([^"]*)"/g)].map((m) => [m[1], m[2]]));
    if (req.system.includes("sort Product Hunt products")) {
      calls.classify += 1;
      if (opts.failClassify) throw new Error("gemini down");
      return ids.map((id) => ({ id, categories: opts.categoryFor ? opts.categoryFor(id) : ["team_communication"], reason: "fits team tools" }));
    }
    calls.angles += 1;
    if (opts.failAngles) throw new Error("gemini down");
    return ids.map((id) => ({
      id,
      fit: "partial",
      angle: `${names.get(id)} sits near how teams work together, so an async standup integration could fit. A joint post is a good first step.`,
    }));
  };
  return { gen, calls };
}
