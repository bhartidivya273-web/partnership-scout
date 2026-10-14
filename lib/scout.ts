// The one-click pipeline. Order of data sources (never fake data):
//   live -> recent cache -> saved last real result -> bundled snapshot -> clear error.
// Only one live refresh runs at a time (a short-lived lock in the shared store); everyone else is served
// the cache or the saved result, labelled, without spending Product Hunt quota.
//
// Order of work on a pool:
//   classify (Gemini) -> shortlist by engagement -> fit rating (Gemini) -> final priority ranking (code)
//   -> structured outreach for the final top products only (Gemini).
import { createHash } from "node:crypto";
import { BUNDLE_SCHEMA, isBundle, type Bundle } from "./bundle";
import { CATEGORY_KEYS, isCategoryKey, type CategoryKey } from "./categories";
import { classifyProducts, type Classification } from "./classify";
import { COPY } from "./copy";
import { missingInfo, responsiveness, EVIDENCE_TOTAL } from "./evidence";
import { explain } from "./explain";
import { rateFit } from "./fit";
import { GeminiError, type GeminiFn } from "./gemini";
import { cleanProductText } from "./input";
import { logEvent } from "./log";
import { writeOutreach, type Outreach } from "./outreach";
import { buildPool } from "./pool";
import { isPreset, normaliseWeights, PRESETS, rankByPriority, DEFAULT_PRESET, type FitInfo, type PresetName, type PriorityKey } from "./priority";
import { fetchFeaturedPosts, ProductHuntError } from "./producthunt";
import type { ErrorCode, Note, ResultItem, ScoutEvent, ScoutResult, Source, Step } from "./result";
import { safeStore, type Store } from "./store";
import type { ClassifiedProduct } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_N = 20;
const SHORTLIST_N = 40; // candidates rated for fit before the final ranking
const FRESH_TTL = 12 * 60; // the pool is cached for 12 minutes
const PARTIAL_TTL = 3 * 60; // an incomplete pool is only kept very briefly
const MIN_REFRESH_MS = 5 * 60 * 1000; // a forced refresh is refused while the data is younger than this
const LOCK_TTL = 310; // longer than the route's 300-second maximum, so a run that dies still frees the lock
const CAT_TTL = 7 * 24 * 60 * 60;
const AI_TTL = 3 * 24 * 60 * 60;
const MIN_QUOTA = 1400; // one live run costs about 1,300 of the shared 6,250 points

export const KEY = {
  fresh: "ps:v2:pool:fresh",
  last: "ps:v2:pool:last",
  lock: "ps:v1:lock",
  quota: "ps:v1:quota",
};
const catKey = (model: string, id: string) => `ps:v1:cat:${model}:${id}`;
const fitKey = (model: string, hash: string, id: string) => `ps:v2:fit:${model}:${hash}:${id}`;
const outKey = (model: string, hash: string, id: string) => `ps:v2:out:${model}:${hash}:${id}`;

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

export type ScoutInput = {
  categories?: unknown;
  productText?: unknown;
  /** Named weighting: "balanced", "engagement" or "fit". */
  preset?: unknown;
  /** Custom weights (points per signal); rescaled to 100. Wins over `preset`. */
  weights?: unknown;
  /** Ask for fresh data instead of the cache (refused while the data is under 5 minutes old). */
  refresh?: unknown;
};

type Quota = { remaining: number; resetAt: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Logs why Gemini calls fail (one word per failure, never any text or key) and passes the error on. */
function observed(gen: GeminiFn | null, job: string): GeminiFn | null {
  if (!gen) return null;
  return async (req) => {
    try {
      return await gen(req);
    } catch (err) {
      logEvent("gemini.failed", { job, attempt: req.attempt, kind: err instanceof GeminiError ? err.kind : "other" });
      throw err;
    }
  };
}

async function loadPool(
  deps: Deps,
  s: Store,
  emit: (e: ScoutEvent) => void,
  notes: Set<Note>,
  refresh: boolean,
): Promise<{ bundle: Bundle; source: Source }> {
  const now = deps.now ?? (() => new Date());

  const fresh = await s.get<Bundle>(KEY.fresh);
  if (isBundle(fresh)) {
    const age = now().getTime() - Date.parse(fresh.fetchedAt);
    if (!refresh || age < MIN_REFRESH_MS) {
      if (refresh) notes.add("refresh_throttled"); // protects the shared Product Hunt quota
      return { bundle: fresh, source: "cached" };
    }
  }

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
        schema: BUNDLE_SCHEMA,
        fetchedAt: startedAt.toISOString(),
        products: buildPool(r.posts, startedAt),
        pages: r.pages,
        partial: r.partial,
        quotaRemaining: r.quotaRemaining,
        classifications: {},
        fits: {},
        productText: "",
        outreach: {},
      };
      logEvent("producthunt.fetched", { pages: r.pages, posts: r.posts.length, inWindow: bundle.products.length, partial: r.partial, quotaRemaining: r.quotaRemaining });
      if (r.quotaRemaining !== null) {
        await s.set(KEY.quota, { remaining: r.quotaRemaining, resetAt: startedAt.getTime() + (r.quotaResetSeconds ?? 900) * 1000 }, 900);
      }
      return { bundle, source: "live" };
    } catch (err) {
      logEvent("producthunt.failed", { kind: err instanceof ProductHuntError ? err.kind : "other" });
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

  // A forced refresh that could not go live still has the cached pool it started from.
  if (isBundle(fresh)) return { bundle: fresh, source: "cached" };
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

const methodOf = (aiCount: number, total: number): "ai" | "tags" | "mixed" => (total === 0 || aiCount === total ? "ai" : aiCount === 0 ? "tags" : "mixed");

function resolveWeights(input: ScoutInput) {
  if (input.weights && typeof input.weights === "object") {
    return { weights: normaliseWeights(input.weights as Partial<Record<PriorityKey, unknown>>), preset: "custom" as const };
  }
  const preset: PresetName = isPreset(input.preset) ? input.preset : DEFAULT_PRESET;
  return { weights: { ...PRESETS[preset] }, preset };
}

export async function runScout(input: ScoutInput, deps: Deps, emit: (e: ScoutEvent) => void = () => {}): Promise<ScoutResult> {
  const started = Date.now();
  const nowFn = deps.now ?? (() => new Date());
  const s = safeStore(deps.store);
  const categories: CategoryKey[] = CATEGORY_KEYS.filter((k) => Array.isArray(input.categories) && (input.categories as unknown[]).filter(isCategoryKey).includes(k));
  if (categories.length === 0) throw new ScoutError("no_category");
  const productText = cleanProductText(input.productText);
  const textHash = createHash("sha256").update(productText).digest("hex").slice(0, 12);
  const { weights, preset } = resolveWeights(input);
  const notes = new Set<Note>();
  const timings: Partial<Record<Step, number>> = {};
  const timed = async <T>(step: Step, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      timings[step] = (timings[step] ?? 0) + (Date.now() - t);
    }
  };
  const genClassify = observed(deps.gen, "classify");
  const genFit = observed(deps.gen, "fit");
  const genOutreach = observed(deps.gen, "outreach");
  const aiOpts = { retryDelayMs: deps.retryDelayMs };

  const { bundle, source } = await timed("fetch", () => loadPool(deps, s, emit, notes, input.refresh === true));
  const products = bundle.products;

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
    const { results } = await timed("categorize", () => classifyProducts(need, genClassify, aiOpts));
    results.forEach((c, id) => classif.set(id, c));
    // Topic-table guesses are not cached, so the next run tries Gemini again.
    await s.mset(
      [...results].filter(([, c]) => c.source === "gemini").map(([id, c]) => [catKey(deps.model, id), c] as [string, Classification]),
      CAT_TTL,
    );
  }
  if (products.some((p) => classif.get(p.id)?.source === "topic")) notes.add("category_topic");

  // ----- the candidate pool: launches in the chosen categories
  const candidates: ClassifiedProduct[] = products.flatMap((p) => {
    const c = classif.get(p.id);
    if (!c || !c.categories.some((k) => categories.includes(k))) return [];
    return [{ ...p, categories: c.categories, categorySource: c.source, categoryReason: c.reason }];
  });

  // ----- fit ratings: seeds from the saved result, the shared cache, then Gemini for the rest
  const fits = new Map<string, FitInfo>();
  if (bundle.productText === productText) for (const [id, f] of Object.entries(bundle.fits ?? {})) fits.set(id, f);
  const attempted = new Set<string>();
  let announcedFit = false;
  const ensureFits = async (list: ClassifiedProduct[]) => {
    const todo = list.filter((p) => !fits.has(p.id) && !attempted.has(p.id));
    if (todo.length === 0) return;
    const cached = await s.mget<FitInfo>(todo.map((p) => fitKey(deps.model, textHash, p.id)));
    todo.forEach((p, i) => {
      const c = cached[i];
      if (c?.fit && c.relevance) fits.set(p.id, c);
    });
    const unrated = todo.filter((p) => !fits.has(p.id));
    todo.forEach((p) => attempted.add(p.id));
    if (unrated.length === 0) return;
    if (!announcedFit) {
      announcedFit = true;
      emit({ type: "step", step: "fit" });
    }
    const rated = await rateFit(unrated, productText, genFit, aiOpts);
    rated.forEach((v, id) => fits.set(id, v));
    await s.mset([...rated].map(([id, v]) => [fitKey(deps.model, textHash, id), v] as [string, FitInfo]), AI_TTL);
  };

  emit({ type: "step", step: "rank" });
  // The shortlist is chosen from fit-independent signals only (relevance counts as neutral for everyone),
  // so which products are considered never depends on what happens to be cached. Only the shortlist is
  // rated for fit, and the final order is decided inside it.
  const shortlistIds = new Set(
    rankByPriority(candidates, new Map(), weights)
      .slice(0, SHORTLIST_N)
      .map((p) => p.id),
  );
  await timed("fit", () => ensureFits(candidates.filter((p) => shortlistIds.has(p.id))));
  const ranked = rankByPriority(candidates, fits, weights)
    .filter((p) => shortlistIds.has(p.id))
    .map((p, i) => ({ ...p, rank: i + 1 }));
  const top = ranked.slice(0, TOP_N);

  // ----- outreach for the shown products only
  const outreach = new Map<string, Outreach>();
  if (bundle.productText === productText) for (const p of top) if (bundle.outreach?.[p.id]) outreach.set(p.id, bundle.outreach[p.id]);
  let missing = top.filter((p) => !outreach.has(p.id));
  if (missing.length > 0) {
    const cached = await s.mget<Outreach>(missing.map((p) => outKey(deps.model, textHash, p.id)));
    missing.forEach((p, i) => cached[i]?.message && outreach.set(p.id, cached[i] as Outreach));
    missing = missing.filter((p) => !outreach.has(p.id));
  }
  if (missing.length > 0) {
    emit({ type: "step", step: "outreach" });
    const written = await timed("outreach", () =>
      writeOutreach(
        missing.map((p) => ({ ...p, fit: p.fitInfo?.fit ?? null, founderName: p.founder.visibleMakers[0]?.name ?? null })),
        productText,
        genOutreach,
        aiOpts,
      ),
    );
    written.forEach((o, id) => outreach.set(id, o));
    await s.mset([...written].filter(([, o]) => o.source === "gemini").map(([id, o]) => [outKey(deps.model, textHash, id), o] as [string, Outreach]), AI_TTL);
  }

  if (top.some((p) => !p.fitInfo)) notes.add("fit_unrated");
  if (top.some((p) => outreach.get(p.id)?.source === "template")) notes.add("outreach_template");
  if (bundle.partial) notes.add("partial");

  // ----- keep the real result: the cache for a few minutes, the saved copy until the next live run
  if (source === "live") {
    // Only Gemini's own answers are kept as seeds. Fallback guesses (topic tags, templates) are
    // recomputed on demand, so the next visitor retries Gemini instead of inheriting a weak result.
    const full: Bundle = {
      ...bundle,
      classifications: Object.fromEntries([...classif].filter(([, c]) => c.source === "gemini")),
      fits: Object.fromEntries(fits),
      productText,
      outreach: Object.fromEntries(top.flatMap((p) => (outreach.get(p.id)?.source === "gemini" ? [[p.id, outreach.get(p.id)!]] : []))),
    };
    const degraded = products.length === 0 || notes.has("category_topic") || notes.has("outreach_template") || notes.has("fit_unrated");
    // A degraded pool is cached as long as a good one: retrying Gemini never needs Product Hunt again,
    // because only Gemini's own answers are cached per product and the rest is recomputed on each request.
    await s.set(KEY.fresh, full, bundle.partial ? PARTIAL_TTL : FRESH_TTL);
    // A weaker run never replaces a good saved result; it is only saved if nothing is saved yet.
    if (!bundle.partial && (!degraded || !isBundle(await s.get<Bundle>(KEY.last)))) await s.set(KEY.last, full);
  }

  const end = new Date(bundle.fetchedAt);
  const items: ResultItem[] = top.map((p) => ({
    rank: p.rank,
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    productHuntUrl: p.productHuntUrl,
    websiteUrl: p.websiteUrl,
    founder: {
      label: p.founder.label,
      founderSource: p.founder.founderSource,
      hiddenCount: p.founder.hiddenCount,
      totalMakers: p.founder.totalMakers,
      makers: p.founder.visibleMakers.map((m) => ({ ...m })),
    },
    upvotes: p.upvotes,
    makerComments: p.makerComments,
    daysSinceLaunch: p.daysSinceLaunch,
    daysLeft: p.daysLeft,
    launchedAt: p.launchedAt,
    phRank: { daily: p.dailyRank, weekly: p.weeklyRank },
    reviews: { count: p.reviewsCount, rating: p.reviewsRating },
    categories: p.categories,
    categorySource: p.categorySource,
    fit: p.fitInfo?.fit ?? null,
    relevance: p.fitInfo?.relevance ?? null,
    priority: { total: p.priority.total, parts: p.priority.parts },
    core: p.core,
    votesRank: p.votesRank,
    makerRank: p.makerRank,
    evidence: { checks: p.evidence, count: p.evidenceCount, total: EVIDENCE_TOTAL },
    responsiveness: responsiveness(p.makerComments, p.makerRank, candidates.length),
    missing: missingInfo(p, Boolean(p.fitInfo)),
    why: explain(p, candidates.length),
    outreach: outreach.get(p.id)!,
  }));

  const aiOutreach = items.filter((i) => i.outreach.source === "gemini").length;
  const age = nowFn().getTime() - Date.parse(bundle.fetchedAt);
  const refreshAfterSeconds = source === "live" ? MIN_REFRESH_MS / 1000 : source === "cached" ? Math.max(0, Math.ceil((MIN_REFRESH_MS - age) / 1000)) : 0;
  const result: ScoutResult = {
    source,
    dataAsOf: bundle.fetchedAt,
    windowStart: new Date(end.getTime() - 7 * DAY_MS).toISOString(),
    windowEnd: bundle.fetchedAt,
    scanned: products.length,
    inCategories: candidates.length,
    shown: items.length,
    categories,
    preset,
    weights,
    items,
    notes: [...notes],
    refreshAfterSeconds,
    run: {
      pages: source === "live" ? bundle.pages : null,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      quotaRemaining: bundle.quotaRemaining,
      categoryMethod: methodOf(candidates.filter((c) => c.categorySource === "gemini").length, candidates.length),
      outreachMethod: items.length === 0 || aiOutreach === items.length ? "ai" : aiOutreach === 0 ? "template" : "mixed",
      model: deps.model,
      store: deps.store.kind,
      shortlisted: Math.min(SHORTLIST_N, candidates.length),
      timings,
    },
  };
  logEvent("scout.run", {
    source,
    scanned: result.scanned,
    candidates: result.inCategories,
    shown: result.shown,
    rated: fits.size,
    seconds: result.run.seconds,
    timings,
    notes: result.notes,
    categoryMethod: result.run.categoryMethod,
    outreachMethod: result.run.outreachMethod,
    store: result.run.store,
    preset,
  });
  return result;
}
