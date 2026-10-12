// The one-click pipeline (PRD Section 7 data flow). Order of data sources, per PRD A4:
//   live -> recent cache -> saved last real result -> bundled snapshot -> clear error. Never fake data.
// Only one live refresh runs at a time (PRD A2): a short-lived lock in the shared store, and everyone
// else is served the cache or the saved result, labelled, without spending Product Hunt quota.
import { createHash } from "node:crypto";
import { writeAngles, type Angle } from "./angles";
import { isBundle, type Bundle } from "./bundle";
import { CATEGORY_KEYS, isCategoryKey, type CategoryKey } from "./categories";
import { classifyProducts, type Classification } from "./classify";
import { COPY } from "./copy";
import type { GeminiFn } from "./gemini";
import { cleanProductText } from "./input";
import { buildPool } from "./pool";
import { fetchFeaturedPosts, ProductHuntError } from "./producthunt";
import type { ErrorCode, Note, ResultItem, ScoutEvent, ScoutResult, Source } from "./result";
import { DEFAULT_WEIGHTS, rankPool } from "./scoring";
import { safeStore, type Store } from "./store";
import type { ClassifiedProduct } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_N = 20;
const FRESH_TTL = 12 * 60; // the pool is cached for 12 minutes (PRD: about 10 to 15)
const PARTIAL_TTL = 3 * 60; // an incomplete pool is only kept very briefly
const LOCK_TTL = 310; // longer than the route's 300-second maximum, so a run that dies still frees the lock
const CAT_TTL = 7 * 24 * 60 * 60;
const ANGLE_TTL = 3 * 24 * 60 * 60;
const MIN_QUOTA = 1400; // one live run costs about 1,300 of the shared 6,250 points

export const KEY = {
  fresh: "ps:v1:pool:fresh",
  last: "ps:v1:pool:last",
  lock: "ps:v1:lock",
  quota: "ps:v1:quota",
};
const catKey = (model: string, id: string) => `ps:v1:cat:${model}:${id}`;
const angleKey = (model: string, textHash: string, id: string) => `ps:v1:angle:${model}:${textHash}:${id}`;

export class ScoutError extends Error {
  constructor(public code: ErrorCode) {
    super(code === "token" ? COPY.ERR_TOKEN : code === "no_data" ? COPY.ERR_NO_DATA : code === "no_category" ? COPY.HINT_CATEGORY : COPY.ERR_GENERIC);
  }
}

export type Deps = {
  store: Store;
  gen: GeminiFn | null;
  model: string;
  token?: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  snapshot?: Bundle | null;
  /** How long to wait for another visitor's refresh when there is nothing else to show. */
  waitForRefreshMs?: number;
  pollMs?: number;
  retryDelayMs?: number;
};

type Quota = { remaining: number; resetAt: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadPool(deps: Deps, s: Store, emit: (e: ScoutEvent) => void, notes: Set<Note>): Promise<{ bundle: Bundle; source: Source }> {
  const now = deps.now ?? (() => new Date());

  const fresh = await s.get<Bundle>(KEY.fresh);
  if (isBundle(fresh)) return { bundle: fresh, source: "cached" };

  let lockedOut = false;
  const quota = await s.get<Quota>(KEY.quota);
  if (quota && quota.remaining < MIN_QUOTA && now().getTime() < quota.resetAt) {
    notes.add("quota_low"); // not enough shared quota left for a full run; do not even try
  } else if (await s.setNX(KEY.lock, 1, LOCK_TTL)) {
    try {
      emit({ type: "step", step: "fetch" });
      const startedAt = now();
      const r = await fetchFeaturedPosts({ token: deps.token, now: startedAt, fetchImpl: deps.fetchImpl, retryDelayMs: deps.retryDelayMs });
      const bundle: Bundle = {
        fetchedAt: startedAt.toISOString(),
        products: buildPool(r.posts, startedAt),
        pages: r.pages,
        partial: r.partial,
        quotaRemaining: r.quotaRemaining,
        classifications: {},
        productText: "",
        angles: {},
      };
      if (r.quotaRemaining !== null) {
        await s.set(KEY.quota, { remaining: r.quotaRemaining, resetAt: startedAt.getTime() + (r.quotaResetSeconds ?? 900) * 1000 }, 900);
      }
      return { bundle, source: "live" };
    } catch (err) {
      // A wrong token is a setup problem to fix, not something to hide behind older data.
      if (err instanceof ProductHuntError && err.kind === "token") throw new ScoutError("token");
      if (err instanceof ProductHuntError && err.kind === "rate_limited") {
        await s.set(KEY.quota, { remaining: 0, resetAt: now().getTime() + (err.resetSeconds ?? 900) * 1000 }, 900);
      }
      notes.add("live_failed");
    } finally {
      await s.del(KEY.lock);
    }
  } else {
    notes.add("refresh_in_progress"); // someone else is refreshing right now
    lockedOut = true;
  }

  const last = await s.get<Bundle>(KEY.last);
  if (isBundle(last)) return { bundle: last, source: "saved" };
  if (isBundle(deps.snapshot)) return { bundle: deps.snapshot, source: "snapshot" };

  if (lockedOut) {
    const deadline = Date.now() + (deps.waitForRefreshMs ?? 90_000);
    while (Date.now() < deadline) {
      await sleep(deps.pollMs ?? 1500);
      const f = await s.get<Bundle>(KEY.fresh);
      if (isBundle(f)) return { bundle: f, source: "cached" };
    }
  }
  throw new ScoutError("no_data");
}

const methodOf = (aiCount: number, total: number): "ai" | "tags" | "mixed" =>
  total === 0 || aiCount === total ? "ai" : aiCount === 0 ? "tags" : "mixed";

export async function runScout(
  input: { categories?: unknown; productText?: unknown },
  deps: Deps,
  emit: (e: ScoutEvent) => void = () => {},
): Promise<ScoutResult> {
  const started = Date.now();
  const s = safeStore(deps.store);
  const categories: CategoryKey[] = CATEGORY_KEYS.filter((k) => Array.isArray(input.categories) && (input.categories as unknown[]).filter(isCategoryKey).includes(k));
  if (categories.length === 0) throw new ScoutError("no_category");
  const productText = cleanProductText(input.productText);
  const textHash = createHash("sha256").update(productText).digest("hex").slice(0, 12);
  const notes = new Set<Note>();

  const { bundle, source } = await loadPool(deps, s, emit, notes);
  const products = bundle.products;
  const aiOpts = { retryDelayMs: deps.retryDelayMs };

  // ----- categories: saved with the pool, then the shared cache, then Gemini for what is still unknown
  const classif = new Map<string, Classification>(Object.entries(bundle.classifications ?? {}));
  let need = products.filter((p) => !classif.has(p.id));
  if (need.length > 0) {
    const cached = await s.mget<Classification>(need.map((p) => catKey(deps.model, p.id)));
    need.forEach((p, i) => {
      const c = cached[i];
      if (c && Array.isArray(c.categories)) classif.set(p.id, c);
    });
    need = need.filter((p) => !classif.has(p.id));
  }
  if (need.length > 0) {
    emit({ type: "step", step: "categorize" });
    const { results } = await classifyProducts(need, deps.gen, aiOpts);
    results.forEach((c, id) => classif.set(id, c));
    // Topic-table guesses are not cached, so the next run tries Gemini again.
    await s.mset(
      [...results].filter(([, c]) => c.source === "gemini").map(([id, c]) => [catKey(deps.model, id), c] as [string, Classification]),
      CAT_TTL,
    );
  }
  if (products.some((p) => classif.get(p.id)?.source === "topic")) notes.add("category_topic");

  // ----- filter to the chosen categories, score and rank
  emit({ type: "step", step: "rank" });
  const candidates: ClassifiedProduct[] = products.flatMap((p) => {
    const c = classif.get(p.id);
    if (!c || !c.categories.some((k) => categories.includes(k))) return [];
    return [{ ...p, categories: c.categories, categorySource: c.source, categoryReason: c.reason }];
  });
  const ranked = rankPool(candidates, DEFAULT_WEIGHTS);
  const top = ranked.slice(0, TOP_N);

  // ----- angles for the shown products only
  const angles = new Map<string, Angle>();
  if (bundle.productText === productText) for (const p of top) if (bundle.angles?.[p.id]) angles.set(p.id, bundle.angles[p.id]);
  let missing = top.filter((p) => !angles.has(p.id));
  if (missing.length > 0) {
    const cached = await s.mget<Angle>(missing.map((p) => angleKey(deps.model, textHash, p.id)));
    missing.forEach((p, i) => cached[i]?.angle && angles.set(p.id, cached[i] as Angle));
    missing = missing.filter((p) => !angles.has(p.id));
  }
  if (missing.length > 0) {
    emit({ type: "step", step: "angles" });
    const written = await writeAngles(missing, productText, deps.gen, aiOpts);
    written.forEach((a, id) => angles.set(id, a));
    await s.mset(
      [...written].filter(([, a]) => a.angleSource === "gemini").map(([id, a]) => [angleKey(deps.model, textHash, id), a] as [string, Angle]),
      ANGLE_TTL,
    );
  }

  // ----- keep the real result: the cache for a few minutes, the saved copy until the next live run
  if (source === "live") {
    // Only Gemini's own answers are kept as seeds. Fallback guesses (topic tags, templates) are
    // recomputed on demand, so the next visitor retries Gemini instead of inheriting a weak result.
    const full: Bundle = {
      ...bundle,
      classifications: Object.fromEntries([...classif].filter(([, c]) => c.source === "gemini")),
      productText,
      angles: Object.fromEntries(top.flatMap((p) => (angles.get(p.id)?.angleSource === "gemini" ? [[p.id, angles.get(p.id)!]] : []))),
    };
    const degraded =
      products.length === 0 || notes.has("category_topic") || top.some((p) => angles.get(p.id)?.angleSource === "template");
    await s.set(KEY.fresh, full, bundle.partial || degraded ? PARTIAL_TTL : FRESH_TTL);
    // A weaker run never replaces a good saved result; it is only saved if nothing is saved yet.
    if (!bundle.partial && (!degraded || !isBundle(await s.get<Bundle>(KEY.last)))) await s.set(KEY.last, full);
  }
  if (bundle.partial) notes.add("partial");

  const end = new Date(bundle.fetchedAt);
  const items: ResultItem[] = top.map((p) => {
    const a = angles.get(p.id)!;
    return {
      rank: p.rank,
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      productHuntUrl: p.productHuntUrl,
      websiteUrl: p.websiteUrl,
      founder: { label: p.founder.label, founderSource: p.founder.founderSource, hiddenCount: p.founder.hiddenCount, totalMakers: p.founder.totalMakers },
      upvotes: p.upvotes,
      makerComments: p.makerComments,
      daysSinceLaunch: p.daysSinceLaunch,
      daysLeft: p.daysLeft,
      launchedAt: p.launchedAt,
      score: { votesPart: p.score.votesPart, makerPart: p.score.makerPart, total: p.score.total },
      categories: p.categories,
      categorySource: p.categorySource,
      fit: a.fit,
      angle: a.angle,
      angleSource: a.angleSource,
    };
  });
  const aiAngles = items.filter((i) => i.angleSource === "gemini").length;
  const basis = candidates.length > 0 ? candidates : [];

  return {
    source,
    dataAsOf: bundle.fetchedAt,
    windowStart: new Date(end.getTime() - 7 * DAY_MS).toISOString(),
    windowEnd: bundle.fetchedAt,
    scanned: products.length,
    inCategories: candidates.length,
    shown: items.length,
    categories,
    weights: DEFAULT_WEIGHTS,
    items,
    notes: [...notes],
    run: {
      pages: source === "live" ? bundle.pages : null,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      quotaRemaining: bundle.quotaRemaining,
      categoryMethod: methodOf(basis.filter((c) => c.categorySource === "gemini").length, basis.length),
      angleMethod: items.length === 0 ? "ai" : aiAngles === items.length ? "ai" : aiAngles === 0 ? "template" : "mixed",
      model: deps.model,
      store: deps.store.kind,
    },
  };
}
