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
  it("E1: a first run goes live, reads 13 pages, and shows 20 ranked rows with angles", async () => {
    const { deps, ph } = setup();
    const r = await run(deps);
    expect(r.source).toBe("live");
    expect(ph.calls.n).toBe(13);
    expect(r.scanned).toBe(251);
    expect(r.shown).toBe(20);
    expect(r.items.map((i) => i.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(r.items.every((i) => i.angle.length > 0)).toBe(true);
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

  it("B12 / A7: changing the product text re-writes angles but never refetches Product Hunt", async () => {
    const { deps, ph, ai } = setup();
    await run(deps, { categories: ALL, productText: "Software for async standups" });
    const phBefore = ph.calls.n;
    const anglesBefore = ai.calls.angles;
    await run(deps, { categories: ALL, productText: "Chat software for dentists" });
    expect(ph.calls.n).toBe(phBefore);
    expect(ai.calls.angles).toBeGreaterThan(anglesBefore);
  });

  it("repeating the same text reuses the saved angles and calls Gemini again for nothing", async () => {
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
    await store.del("ps:v1:pool:fresh"); // cache expired, saved result remains
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
    await store.del("ps:v1:pool:fresh");
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
    await good.store.del("ps:v1:pool:fresh");
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
    const snapshot = await live.store.get<Bundle>("ps:v1:pool:last");
    const { deps } = setup({ snapshot }, fakePH(251, { failWith: 503 }), fakeGemini({ failClassify: true, failAngles: true }));
    const r = await run(deps);
    expect(r.source).toBe("snapshot");
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.angle)).toBe(true);
  });

  it("the snapshot keeps its real angles and categories without any AI call (angles seeded)", async () => {
    const live = setup();
    const first = await run(live.deps);
    const snapshot = await live.store.get<Bundle>("ps:v1:pool:last");
    const ai = fakeGemini({ failClassify: true, failAngles: true });
    const { deps } = setup({ snapshot }, fakePH(251, { failWith: 503 }), ai);
    const r = await run(deps);
    expect(ai.calls).toEqual({ classify: 0, angles: 0 });
    expect(r.items.map((i) => i.angle)).toEqual(first.items.map((i) => i.angle));
    expect(r.items.every((i) => i.angleSource === "gemini")).toBe(true);
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
    await good.store.del("ps:v1:pool:fresh");
    const err = (await run({ ...good.deps, fetchImpl: fakePH(251, { failWith: 401 }).fetchImpl }).catch((e) => e)) as ScoutError;
    expect(err.code).toBe("token");
  });

  it("E6: when the shared quota is low, no Product Hunt request is made and the saved result is used", async () => {
    const good = setup();
    await run(good.deps);
    await good.store.del("ps:v1:pool:fresh");
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
    await good.store.del("ps:v1:pool:fresh");
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

  it("E10: if Gemini angles fail, every row has a labelled template angle", async () => {
    const { deps } = setup({}, fakePH(60), fakeGemini({ failAngles: true }));
    const r = await run(deps);
    expect(r.items.every((i) => i.angleSource === "template" && i.fit === null)).toBe(true);
    expect(r.run.angleMethod).toBe("template");
  });

  it("E11: with no Gemini key at all the page still works", async () => {
    const { deps } = setup({ gen: null }, fakePH(60));
    const r = await run(deps);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.run.categoryMethod).toBe("tags");
    expect(r.run.angleMethod).toBe("template");
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
    expect(await store.get("ps:v1:pool:last")).toBeNull();
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
    const goodLast = await good.store.get<Bundle>("ps:v1:pool:last");
    // A new, empty store that only holds the earlier saved result (no category or angle cache).
    const store = createMemoryStore();
    await store.set("ps:v1:pool:last", goodLast);
    const weak = await run({ ...good.deps, store, gen: fakeGemini({ failClassify: true, failAngles: true }).gen });
    expect(weak.source).toBe("live");
    expect(weak.notes).toContain("category_topic");
    expect(weak.run.angleMethod).toBe("template");
    expect(await store.get("ps:v1:pool:last")).toEqual(goodLast);
  });

  it("with nothing saved yet, a weak run is still saved (real data beats nothing)", async () => {
    const { deps, store } = setup({}, fakePH(60), fakeGemini({ failClassify: true, failAngles: true }));
    await run(deps);
    expect(await store.get("ps:v1:pool:last")).not.toBeNull();
  });

  it("fallback guesses are not kept as seeds, so the next visitor retries Gemini", async () => {
    const { deps, store } = setup({}, fakePH(60), fakeGemini({ failClassify: true, failAngles: true }));
    await run(deps);
    const saved = await store.get<Bundle>("ps:v1:pool:last");
    expect(saved?.classifications).toEqual({});
    expect(saved?.angles).toEqual({});
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
