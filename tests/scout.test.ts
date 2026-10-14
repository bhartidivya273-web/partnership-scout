import { describe, expect, it } from "vitest";
import type { Bundle } from "@/lib/bundle";
import { runScout, ScoutError, type Deps } from "@/lib/scout";
import { createMemoryStore, type Store } from "@/lib/store";
import { fakeGemini, fakePH, NOW, rawPost } from "./fakes";

const ALL = ["project_management", "hr_tech", "developer_productivity", "team_communication"];

function setup(over: Partial<Deps> = {}, ph = fakePH(251), ai = fakeGemini()) {
  const store = createMemoryStore();
  const deps: Deps = { store, gen: ai.gen, model: "m", token: "tok", now: () => NOW, fetchImpl: ph.fetchImpl, retryDelayMs: 0, pollMs: 5, waitForRefreshMs: 2000, ...over };
  return { deps, store, ph, ai };
}
const run = (deps: Deps, input: { categories?: unknown; productText?: unknown } = { categories: ALL }) => runScout(input, deps);

describe("pipeline: normal runs (E1, E2)", () => {
  it("E1: a first run goes live, reads 13 pages, and shows 20 ranked rows with structured outreach", async () => {
    const { deps, ph } = setup();
    const r = await run(deps);
    expect(r.source).toBe("live");
    expect(ph.calls.n).toBe(13);
    expect(r.scanned).toBe(251);
    expect(r.shown).toBe(20);
    expect(r.items.map((i) => i.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(r.items.every((i) => i.outreach.message.length > 0 && i.outreach.question.endsWith("?"))).toBe(true);
    expect(r.run.pages).toBe(13);
    expect(r.windowEnd).toBe(NOW.toISOString());
  });

  it("E2: a second run inside the cache time makes zero Product Hunt requests and says cached", async () => {
    const { deps, ph } = setup();
    await run(deps);
    const before = ph.calls.n;
    const r = await run(deps);
    expect(r.source).toBe("cached");
    expect(ph.calls.n).toBe(before);
  });

  it("B12 / A7: changing the product text re-writes fit and outreach but never refetches Product Hunt", async () => {
    const { deps, ph, ai } = setup();
    await run(deps, { categories: ALL, productText: "Software for async standups" });
    const phBefore = ph.calls.n;
    const outreachBefore = ai.calls.outreach;
    const fitBefore = ai.calls.fit;
    await run(deps, { categories: ALL, productText: "Chat software for dentists" });
    expect(ph.calls.n).toBe(phBefore);
    expect(ai.calls.outreach).toBeGreaterThan(outreachBefore);
    expect(ai.calls.fit).toBeGreaterThan(fitBefore);
  });

  it("repeating the same text reuses the saved fit and outreach and calls Gemini again for nothing", async () => {
    const { deps, ai } = setup();
    await run(deps);
    const c = { ...ai.calls };
    await run(deps);
    expect(ai.calls).toEqual(c);
  });

  it("changing categories re-ranks the cached pool with no Product Hunt request", async () => {
    const ai = fakeGemini({ categoryFor: (id) => (Number(id) % 2 ? ["hr_tech"] : ["developer_productivity"]) });
    const { deps, ph } = setup({}, fakePH(251), ai);
    const all = await run(deps);
    const calls = ph.calls.n;
    const hr = await run(deps, { categories: ["hr_tech"] });
    expect(ph.calls.n).toBe(calls);
    expect(hr.inCategories).toBeLessThan(all.inCategories);
    expect(hr.items.every((i) => i.categories.includes("hr_tech"))).toBe(true);
  });
});

describe("pipeline: single-flight refresh (PRD A2)", () => {
  it("three simultaneous requests on an empty cache cause exactly one live Product Hunt run", async () => {
    const { deps, ph } = setup();
    const results = await Promise.all([run(deps), run(deps), run(deps)]);
    expect(ph.calls.n).toBe(13); // one run, not 39
    expect(results.filter((r) => r.source === "live")).toHaveLength(1);
    expect(results.filter((r) => r.source === "cached")).toHaveLength(2);
  });

  it("with a saved result available, a visitor during a refresh gets it labelled, with no new requests", async () => {
    const { deps, ph, store } = setup();
    await run(deps); // creates the saved result
    await store.del("ps:v2:pool:fresh"); // cache expired, saved result remains
    ph.calls.n = 0;
    const [a, b] = await Promise.all([run(deps), run(deps)]);
    const sources = [a.source, b.source].sort();
    expect(sources).toEqual(["live", "saved"]);
    expect(ph.calls.n).toBe(13);
    const saved = [a, b].find((r) => r.source === "saved")!;
    expect(saved.notes).toContain("refresh_in_progress");
  });

  it("the lock is released after a run, so the next expired cache can refresh again", async () => {
    const { deps, store, ph } = setup();
    await run(deps);
    await store.del("ps:v2:pool:fresh");
    ph.calls.n = 0;
    const r = await run(deps);
    expect(r.source).toBe("live");
  });

  it("the lock is released even when the live run fails", async () => {
    const { deps, store } = setup({}, fakePH(251, { failWith: 503 }));
    await run(deps).catch(() => null);
    expect(await store.get("ps:v1:lock")).toBeNull();
  });
});

describe("pipeline: fallbacks (E3, E4, E5, E6)", () => {
  it("E3: Product Hunt fails after a good run: the saved result is served with its time, labelled", async () => {
    const good = setup();
    await run(good.deps);
    await good.store.del("ps:v2:pool:fresh");
    const bad = fakePH(251, { failWith: 429 });
    const r = await run({ ...good.deps, fetchImpl: bad.fetchImpl });
    expect(r.source).toBe("saved");
    expect(r.notes).toContain("live_failed");
    expect(r.dataAsOf).toBe(NOW.toISOString());
    expect(r.items.length).toBeGreaterThan(0);
  });

  it("E4: unreachable with nothing saved and no snapshot gives a plain error, never fake data", async () => {
    const { deps } = setup({}, fakePH(251, { failWith: 503 }));
    const err = (await run(deps).catch((e) => e)) as ScoutError;
    expect(err).toBeInstanceOf(ScoutError);
    expect(err.code).toBe("no_data");
    expect(err.message).toContain("could not reach Product Hunt");
  });

  it("A4: with Product Hunt and storage both empty, the bundled snapshot is shown, labelled as a snapshot", async () => {
    const live = setup();
    await run(live.deps);
    const snapshot = await live.store.get<Bundle>("ps:v2:pool:last");
    const { deps } = setup({ snapshot }, fakePH(251, { failWith: 503 }), fakeGemini({ failClassify: true, failAngles: true }));
    const r = await run(deps);
    expect(r.source).toBe("snapshot");
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.outreach.message)).toBe(true);
  });

  it("the snapshot keeps its real fit, outreach and categories without any AI call (seeded)", async () => {
    const live = setup();
    const first = await run(live.deps);
    const snapshot = await live.store.get<Bundle>("ps:v2:pool:last");
    const ai = fakeGemini({ failClassify: true, failAngles: true });
    const { deps } = setup({ snapshot }, fakePH(251, { failWith: 503 }), ai);
    const r = await run(deps);
    expect(ai.calls).toEqual({ classify: 0, fit: 0, outreach: 0 });
    expect(r.items.map((i) => i.outreach.message)).toEqual(first.items.map((i) => i.outreach.message));
    expect(r.items.every((i) => i.outreach.source === "gemini")).toBe(true);
  });

  it("E5: a missing token is a clear setup error and no request is made", async () => {
    const { deps, ph } = setup({ token: "" });
    const err = (await run(deps).catch((e) => e)) as ScoutError;
    expect(err.code).toBe("token");
    expect(err.message).toContain("Setup problem");
    expect(ph.calls.n).toBe(0);
  });

  it("E5: a rejected token is also a setup error, even if older data exists", async () => {
    const good = setup();
    await run(good.deps);
    await good.store.del("ps:v2:pool:fresh");
    const err = (await run({ ...good.deps, fetchImpl: fakePH(251, { failWith: 401 }).fetchImpl }).catch((e) => e)) as ScoutError;
    expect(err.code).toBe("token");
  });

  it("E6: when the shared quota is low, no Product Hunt request is made and the saved result is used", async () => {
    const good = setup();
    await run(good.deps);
    await good.store.del("ps:v2:pool:fresh");
    await good.store.set("ps:v1:quota", { remaining: 300, resetAt: NOW.getTime() + 600_000 });
    good.ph.calls.n = 0;
    const r = await run(good.deps);
    expect(good.ph.calls.n).toBe(0);
    expect(r.source).toBe("saved");
    expect(r.notes).toContain("quota_low");
  });

  it("a low-quota note that has passed its reset time no longer blocks a live run", async () => {
    const good = setup();
    await run(good.deps);
    await good.store.del("ps:v2:pool:fresh");
    await good.store.set("ps:v1:quota", { remaining: 300, resetAt: NOW.getTime() - 1000 });
    expect((await run(good.deps)).source).toBe("live");
  });

  it("a Product Hunt 429 records the quota so the next visitor does not try again", async () => {
    const { deps, store } = setup({}, fakePH(251, { failWith: 429 }));
    await run(deps).catch(() => null);
    const q = await store.get<{ remaining: number }>("ps:v1:quota");
    expect(q?.remaining).toBe(0);
  });

  it("storage failure does not take the page down: it still goes live", async () => {
    const broken: Store = { ...createMemoryStore(), kind: "supabase" };
    for (const k of ["get", "set", "del", "setNX", "mget", "mset"] as const) (broken as Record<string, unknown>)[k] = async () => { throw new Error("down"); };
    const { deps } = setup({ store: broken });
    const r = await run(deps);
    expect(r.source).toBe("live");
    expect(r.items.length).toBeGreaterThan(0);
  });
});

describe("pipeline: edge cases (E7 to E13)", () => {
  it("E8: no category selected is refused before anything runs", async () => {
    const { deps, ph } = setup();
    for (const categories of [[], undefined, ["nonsense"], "team_communication"]) {
      const err = (await run(deps, { categories }).catch((e) => e)) as ScoutError;
      expect(err.code).toBe("no_category");
    }
    expect(ph.calls.n).toBe(0);
  });

  it("E7: a pool with nothing in the chosen categories gives an empty list, not an error", async () => {
    const ai = fakeGemini({ categoryFor: () => [] });
    const { deps } = setup({}, fakePH(60), ai);
    const r = await run(deps);
    expect(r.items).toEqual([]);
    expect(r.inCategories).toBe(0);
    expect(r.scanned).toBe(60);
  });

  it("E9: if Gemini sorting fails, the topic table is used and the result says so", async () => {
    const { deps } = setup({}, fakePH(60), fakeGemini({ failClassify: true }));
    const r = await run(deps);
    expect(r.notes).toContain("category_topic");
    expect(r.run.categoryMethod).toBe("tags");
    expect(r.items.every((i) => i.categorySource === "topic")).toBe(true);
    expect(r.items.length).toBeGreaterThan(0); // fake posts carry the Task Management topic
  });

  it("E10: if Gemini fit and outreach fail, every row has labelled template outreach and no fit", async () => {
    const { deps } = setup({}, fakePH(60), fakeGemini({ failAngles: true }));
    const r = await run(deps);
    expect(r.items.every((i) => i.outreach.source === "template" && i.fit === null)).toBe(true);
    expect(r.notes).toContain("outreach_template");
    expect(r.notes).toContain("fit_unrated");
    expect(r.run.outreachMethod).toBe("template");
  });

  it("E11: with no Gemini key at all the page still works", async () => {
    const { deps } = setup({ gen: null }, fakePH(60));
    const r = await run(deps);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.run.categoryMethod).toBe("tags");
    expect(r.run.outreachMethod).toBe("template");
  });

  it("E12: a page that keeps failing gives a partial list with a notice, and is not saved as the last good result", async () => {
    const good = fakePH(100);
    let n = 0;
    const flaky = (async (u: unknown, init?: RequestInit) => {
      n += 1;
      const after = JSON.parse(String(init?.body)).variables.after;
      if (after === "40") return new Response("x", { status: 502 });
      return good.fetchImpl(u as RequestInfo, init);
    }) as typeof fetch;
    const { deps, store } = setup({ fetchImpl: flaky }, fakePH(100));
    const r = await run(deps);
    expect(r.notes).toContain("partial");
    expect(r.scanned).toBe(40);
    expect(await store.get("ps:v2:pool:last")).toBeNull();
    expect(n).toBeGreaterThan(0);
  });

  it("E13 / E14 / E15: missing maker count, website and tagline still produce a row", async () => {
    const make = (i: number) => rawPost(i, i === 1 ? { makerReplies: undefined, website: null, tagline: "" } : {});
    const { deps } = setup({}, fakePH(5, { makePost: make }));
    const r = await run(deps);
    const row = r.items.find((i) => i.id === "1")!;
    expect(row.makerComments).toBe(0);
    expect(row.websiteUrl).toBeNull();
    expect(row.tagline).toBe("");
  });

  it("posts outside the window never appear, however Product Hunt returns them", async () => {
    const make = (i: number) => rawPost(i, i <= 3 ? { createdAt: "2026-09-01T00:00:00Z" } : {});
    const { deps } = setup({}, fakePH(10, { makePost: make }));
    const r = await run(deps);
    expect(r.scanned).toBe(7);
    expect(r.items.some((i) => ["1", "2", "3"].includes(i.id))).toBe(false);
  });
});

describe("pipeline: what reaches the browser", () => {
  it("never contains the token, an API key, descriptions, or the text [REDACTED]", async () => {
    const { deps } = setup({ token: "TOKEN-ABC-123" });
    const r = await run(deps);
    const text = JSON.stringify(r);
    expect(text).not.toContain("TOKEN-ABC-123");
    expect(text.toUpperCase()).not.toContain("REDACTED");
    expect(text).not.toContain("Description 1");
  });

  it("the window runs 7 days back from the data time, and day counts are as of that time", async () => {
    const { deps } = setup({}, fakePH(10));
    const r = await run(deps);
    expect(r.windowStart).toBe("2026-10-05T12:00:00.000Z");
    expect(r.items[0].daysSinceLaunch).toBe(1);
    expect(r.items[0].daysLeft).toBe(6);
  });
});

describe("pipeline: a weak run never replaces a good saved result", () => {
  it("a run where Gemini failed keeps the earlier good saved result untouched", async () => {
    const good = setup();
    await run(good.deps);
    const goodLast = await good.store.get<Bundle>("ps:v2:pool:last");
    // A new, empty store that only holds the earlier saved result (no category or angle cache).
    const store = createMemoryStore();
    await store.set("ps:v2:pool:last", goodLast);
    const weak = await run({ ...good.deps, store, gen: fakeGemini({ failClassify: true, failAngles: true }).gen });
    expect(weak.source).toBe("live");
    expect(weak.notes).toContain("category_topic");
    expect(weak.run.outreachMethod).toBe("template");
    expect(await store.get("ps:v2:pool:last")).toEqual(goodLast);
  });

  it("with nothing saved yet, a weak run is still saved (real data beats nothing)", async () => {
    const { deps, store } = setup({}, fakePH(60), fakeGemini({ failClassify: true, failAngles: true }));
    await run(deps);
    expect(await store.get("ps:v2:pool:last")).not.toBeNull();
  });

  it("fallback guesses are not kept as seeds, so the next visitor retries Gemini", async () => {
    const { deps, store } = setup({}, fakePH(60), fakeGemini({ failClassify: true, failAngles: true }));
    await run(deps);
    const saved = await store.get<Bundle>("ps:v2:pool:last");
    expect(saved?.classifications).toEqual({});
    expect(saved?.outreach).toEqual({});
    expect(saved?.fits).toEqual({});
  });

  it("a degraded cached pool is retried quickly: the next run asks Gemini again", async () => {
    const down = fakeGemini({ failClassify: true, failAngles: true });
    const { deps, store } = setup({}, fakePH(60), down);
    await run(deps);
    const up = fakeGemini();
    const r = await run({ ...deps, gen: up.gen, store });
    expect(up.calls.classify).toBeGreaterThan(0); // seeds did not freeze the weak answers
    expect(r.run.categoryMethod).toBe("ai");
  });
});

describe("pipeline: first-principles guards", () => {
  it("an empty live answer from Product Hunt never replaces a good saved result", async () => {
    const good = setup();
    await run(good.deps);
    const goodLast = await good.store.get<Bundle>("ps:v2:pool:last");
    const store = createMemoryStore();
    await store.set("ps:v2:pool:last", goodLast);
    const r = await run({ ...good.deps, store, fetchImpl: fakePH(0).fetchImpl });
    expect(r.items).toEqual([]);
    expect(await store.get("ps:v2:pool:last")).toEqual(goodLast);
  });

  it("a storage call that hangs is abandoned and the page still answers", async () => {
    const hanging: Store = { ...createMemoryStore(), kind: "supabase" };
    for (const k of ["get", "set", "del", "setNX", "mget", "mset"] as const)
      (hanging as Record<string, unknown>)[k] = () => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20));
    const { deps } = setup({ store: hanging });
    const r = await run(deps);
    expect(r.items.length).toBeGreaterThan(0);
  });
});

describe("pipeline: ranking, refresh and evidence (product upgrade)", () => {
  const named = (i: number) =>
    rawPost(i, {
      makers: [
        { id: "0", name: "[REDACTED]", username: "[REDACTED]", url: "[REDACTED]" },
        { id: String(100 + i), name: `Iris Tu${i}`, username: `iris${i}`, headline: "Builder", url: `https://www.producthunt.com/@iris${i}?utm_source=x`, followersCount: 12 },
      ],
      dailyRank: 3,
      weeklyRank: 11,
      reviewsCount: 4,
      reviewsRating: 4.5,
    });

  it("relevance reaches the ranking: strong fits rise above equal-engagement partial fits", async () => {
    const ai = fakeGemini({ fitFor: (id) => (Number(id) <= 3 ? "strong" : "weak") });
    const flat = (i: number) => rawPost(i, { votesCount: 100, makerReplies: 5 }); // identical engagement
    const { deps } = setup({}, fakePH(30, { makePost: flat }), ai);
    const r = await run(deps);
    expect(r.items.slice(0, 3).map((i) => i.fit)).toEqual(["strong", "strong", "strong"]);
    expect(r.items.slice(3).every((i) => i.fit === "weak")).toBe(true);
  });

  it("presets and custom weights re-rank the cached pool without any Product Hunt request", async () => {
    const ai = fakeGemini({ fitFor: (id) => (id === "1" ? "strong" : "weak") });
    const make = (i: number) => rawPost(i, { votesCount: i === 1 ? 5 : 100 + i, makerReplies: i === 1 ? 1 : 9 });
    const { deps, ph } = setup({}, fakePH(40, { makePost: make }), ai);
    const balanced = await runScout({ categories: ALL }, deps);
    const calls = ph.calls.n;
    const fitFirst = await runScout({ categories: ALL, preset: "fit" }, deps);
    const engagement = await runScout({ categories: ALL, preset: "engagement" }, deps);
    const custom = await runScout({ categories: ALL, weights: { votes: 1 } }, deps);
    expect(ph.calls.n).toBe(calls);
    expect(fitFirst.items[0].id).toBe("1"); // the only strong fit wins when relevance dominates
    expect(engagement.items[0].id).not.toBe("1");
    expect(balanced.preset).toBe("balanced");
    expect(fitFirst.preset).toBe("fit");
    expect(custom.preset).toBe("custom");
    expect(custom.weights.votes).toBeCloseTo(100, 6);
    expect(custom.items[0].upvotes).toBeGreaterThanOrEqual(custom.items[1].upvotes); // votes-only order
  });

  it("an unknown preset or junk weights fall back to the balanced default", async () => {
    const { deps } = setup({}, fakePH(30));
    expect((await runScout({ categories: ALL, preset: "nonsense" }, deps)).preset).toBe("balanced");
    const junk = await runScout({ categories: ALL, weights: { votes: "x", maker: -3 } }, deps);
    expect(junk.weights).toMatchObject({ votes: 20, maker: 20, relevance: 30 });
    expect(junk.preset).toBe("balanced"); // not labelled "custom" when nothing custom was usable
    expect((await runScout({ categories: ALL, preset: "fit", weights: {} }, deps)).preset).toBe("fit");
  });

  it("the shortlist is the top 40 by engagement, and every shown row was really rated", async () => {
    const { deps } = setup({}, fakePH(120), fakeGemini());
    const r = await run(deps);
    expect(r.run.shortlisted).toBe(40);
    expect(r.items.every((i) => i.fit !== null && i.relevance)).toBe(true);
  });

  it("a forced refresh inside 5 minutes is refused: cached pool, note, zero Product Hunt requests", async () => {
    const { deps, ph } = setup();
    await run(deps);
    const before = ph.calls.n;
    const r = await runScout({ categories: ALL, refresh: true }, deps);
    expect(ph.calls.n).toBe(before);
    expect(r.source).toBe("cached");
    expect(r.notes).toContain("refresh_throttled");
    expect(r.refreshAfterSeconds).toBeGreaterThan(0);
  });

  it("a forced refresh after 5 minutes fetches live data again", async () => {
    const { deps, ph } = setup();
    await run(deps);
    const before = ph.calls.n;
    const later = { ...deps, now: () => new Date(NOW.getTime() + 6 * 60_000) };
    const r = await runScout({ categories: ALL, refresh: true }, later);
    expect(ph.calls.n).toBe(before + 13);
    expect(r.source).toBe("live");
    expect(r.refreshAfterSeconds).toBe(300);
  });

  it("a forced refresh that cannot go live keeps the pool it started from and says why", async () => {
    const good = setup();
    await run(good.deps);
    const later = { ...good.deps, now: () => new Date(NOW.getTime() + 6 * 60_000), fetchImpl: fakePH(60, { failWith: 503 }).fetchImpl };
    const r = await runScout({ categories: ALL, refresh: true }, later);
    expect(r.source).toBe("cached");
    expect(r.notes).toContain("live_failed");
    expect(r.items.length).toBeGreaterThan(0);
  });

  it("the visible founder's real name travels to the outreach prompt; hidden makers never do", async () => {
    const seen: string[] = [];
    const base = fakeGemini();
    const spy = async (req: Parameters<typeof base.gen>[0]) => (seen.push(req.user), base.gen(req));
    const { deps } = setup({ gen: spy }, fakePH(30, { makePost: named }));
    const r = await run(deps);
    const outreachPrompt = seen.find((u) => u.startsWith("Prepare outreach")) ?? "";
    expect(outreachPrompt).toContain('"founderName":"Iris Tu');
    expect(outreachPrompt.toUpperCase()).not.toContain("REDACTED");
    expect(r.items[0].founder.makers[0]).toMatchObject({ profileUrl: expect.stringMatching(/^https:\/\/www\.producthunt\.com\/@iris\d+$/), followersCount: 12 });
  });

  it("every row carries evidence, a deterministic why, a responsiveness note and what is missing", async () => {
    const { deps } = setup({}, fakePH(30, { makePost: named }));
    const r = await run(deps);
    const i = r.items[0];
    expect(i.evidence.total).toBe(5);
    expect(i.evidence.checks).toHaveLength(5);
    expect(i.why.join(" ")).toContain("maker comments (per Product Hunt)");
    expect(i.why.join(" ")).toContain("#3 of the day, #11 of the week");
    expect(i.why.join(" ")).toContain("4 Product Hunt reviews, average 4.5 out of 5");
    expect(["high", "moderate", "low", "none"]).toContain(i.responsiveness.level);
    expect(i.missing.some((m) => m.includes("no email addresses"))).toBe(true);
    expect(i.priority.total).toBeGreaterThan(0);
    expect(Object.keys(i.priority.parts)).toEqual(["votes", "maker", "momentum", "relevance", "window", "evidence"]);
  });

  it("missing maker information is stated, never filled in", async () => {
    const { deps } = setup({}, fakePH(30)); // default fake posts have only a hidden maker
    const r = await run(deps);
    const i = r.items[0];
    expect(i.founder.founderSource).toBe("none");
    expect(i.founder.makers).toEqual([]);
    expect(i.missing.join(" ")).toContain("Founder not listed");
    expect(i.outreach.message.startsWith("Hi,")).toBe(true);
  });

  it("records how long each stage took", async () => {
    const { deps } = setup({}, fakePH(60));
    const r = await run(deps);
    expect(Object.keys(r.run.timings).sort()).toEqual(expect.arrayContaining(["fetch", "fit", "outreach"]));
  });
});

describe("pipeline: results never depend on cache state", () => {
  it("a cold run and a warm run give the same products, order and fit ratings", async () => {
    const make = (i: number) => rawPost(i, { votesCount: 20 + ((i * 37) % 300), makerReplies: (i * 11) % 23 });
    const ai = fakeGemini({ fitFor: (id) => (["strong", "partial", "weak"] as const)[Number(id) % 3] });
    const { deps } = setup({}, fakePH(120, { makePost: make }), ai);
    const cold = await run(deps);
    const warm = await run(deps);
    const sig = (r: Awaited<ReturnType<typeof run>>) => r.items.map((i) => `${i.rank}:${i.id}:${i.fit}:${i.priority.total}`);
    expect(cold.source).toBe("live");
    expect(warm.source).toBe("cached");
    expect(sig(warm)).toEqual(sig(cold));
  });

  it("the same holds when only the fit and outreach caches are warm (a different instance of the pool)", async () => {
    const make = (i: number) => rawPost(i, { votesCount: 20 + ((i * 37) % 300), makerReplies: (i * 11) % 23 });
    const ai = fakeGemini({ fitFor: (id) => (["strong", "partial", "weak"] as const)[Number(id) % 3] });
    const first = setup({}, fakePH(120, { makePost: make }), ai);
    const cold = await run(first.deps);
    await first.store.del("ps:v2:pool:fresh");
    await first.store.del("ps:v2:pool:last");
    const again = await run(first.deps);
    expect(again.items.map((i) => i.id)).toEqual(cold.items.map((i) => i.id));
    expect(again.items.map((i) => i.fit)).toEqual(cold.items.map((i) => i.fit));
  });

  it("only the shortlist (top 40 on fit-independent signals) can be shown, and relevance re-orders inside it", async () => {
    const make = (i: number) => rawPost(i, { votesCount: 1000 - i, makerReplies: 10 }); // lower id = more votes
    const ai = fakeGemini({ fitFor: (id) => (Number(id) === 39 ? "strong" : "weak") });
    const { deps } = setup({}, fakePH(80, { makePost: make }), ai);
    const r = await run(deps);
    const ids = r.items.map((i) => Number(i.id));
    expect(ids.every((id) => id <= 40)).toBe(true); // nothing from outside the shortlist
    expect(ids[0]).toBe(39); // a strong fit inside the shortlist rises to the top
  });
});

describe("pipeline: outreach always greets the founder shown on the card", () => {
  const makers = (a: string, b: string) => [
    { id: "1", name: `${a} Smith`, username: a.toLowerCase(), url: `https://www.producthunt.com/@${a.toLowerCase()}` },
    { id: "2", name: `${b} Jones`, username: b.toLowerCase(), url: `https://www.producthunt.com/@${b.toLowerCase()}` },
  ];
  it("a cached message for one founder is not reused when Product Hunt lists the makers in another order", async () => {
    const first = setup({}, fakePH(30, { makePost: (i) => rawPost(i, { makers: makers("Howard", "Chen") }) }));
    const a = await run(first.deps);
    expect(a.items.every((i) => i.outreach.message.startsWith("Hi Howard,"))).toBe(true);
    // Same shared caches, but the next fetch lists the makers the other way round.
    await first.store.del("ps:v2:pool:fresh");
    await first.store.del("ps:v2:pool:last");
    const swapped = { ...first.deps, fetchImpl: fakePH(30, { makePost: (i) => rawPost(i, { makers: makers("Chen", "Howard") }) }).fetchImpl };
    const b = await run(swapped);
    expect(b.items.every((i) => i.founder.makers[0].name === "Chen Smith")).toBe(true);
    expect(b.items.every((i) => i.outreach.message.startsWith("Hi Chen,"))).toBe(true);
  });
  it("the same founder keeps the cached message (no needless AI calls)", async () => {
    const ai = fakeGemini();
    const first = setup({}, fakePH(30, { makePost: (i) => rawPost(i, { makers: makers("Howard", "Chen") }) }), ai);
    await run(first.deps);
    await first.store.del("ps:v2:pool:fresh");
    await first.store.del("ps:v2:pool:last");
    const before = ai.calls.outreach;
    await run(first.deps);
    expect(ai.calls.outreach).toBe(before);
  });

  it("saved outreach whose greeting names a different maker than the card shows is discarded and rewritten", async () => {
    const good = setup({}, fakePH(30, { makePost: (i) => rawPost(i, { makers: makers("Howard", "Chen") }) }));
    await run(good.deps);
    const saved = await good.store.get<Bundle>("ps:v2:pool:last");
    // Simulate a bundle written by older code: the first card's message greets someone else.
    const first = Object.keys(saved!.outreach)[0];
    saved!.outreach[first] = { ...saved!.outreach[first], message: saved!.outreach[first].message.replace("Hi Howard,", "Hi Wrongname,") };
    await good.store.set("ps:v2:pool:last", saved);
    await good.store.del("ps:v2:pool:fresh");
    const store = createMemoryStore();
    await store.set("ps:v2:pool:last", saved);
    const r = await run({ ...good.deps, store, fetchImpl: fakePH(30, { failWith: 503 }).fetchImpl });
    expect(r.source).toBe("saved");
    expect(r.items.some((i) => i.outreach.message.includes("Wrongname"))).toBe(false);
    expect(r.items.every((i) => i.outreach.message.startsWith("Hi Howard,"))).toBe(true);
  });
});
