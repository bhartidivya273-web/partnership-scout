// Quality review on REAL data: fetches the live pool once (cached in REVIEW_DIR so repeat runs cost no
// Product Hunt quota), then runs the real pipeline steps and prints what a person should check:
// category labels, fit ratings with reasons, the priority breakdown and the outreach text.
// Run: REVIEW_DIR=/some/folder npx vitest run -c vitest.live.config.mts scripts/review.live.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { CATEGORY_LABELS } from "@/lib/categories";
import { classifyProducts } from "@/lib/classify";
import { rateFit } from "@/lib/fit";
import { makeGemini } from "@/lib/gemini";
import { DEFAULT_PRODUCT_TEXT } from "@/lib/input";
import { writeOutreach } from "@/lib/outreach";
import { buildPool } from "@/lib/pool";
import { PRIORITY_KEYS, rankByPriority } from "@/lib/priority";
import { fetchFeaturedPosts } from "@/lib/producthunt";
import type { ClassifiedProduct, Product } from "@/lib/types";

const dir = process.env.REVIEW_DIR ?? ".review-cache";

it("review on real data", async () => {
  mkdirSync(dir, { recursive: true });
  const poolFile = path.join(dir, "pool.json");
  let pool: Product[];
  if (existsSync(poolFile)) {
    pool = JSON.parse(readFileSync(poolFile, "utf8"));
    console.log(`POOL from cache file: ${pool.length} products`);
  } else {
    const now = new Date();
    const r = await fetchFeaturedPosts({ token: process.env.PRODUCT_HUNT_TOKEN, now });
    pool = buildPool(r.posts, now);
    writeFileSync(poolFile, JSON.stringify(pool));
    console.log(`POOL live: ${pool.length} products, ${r.pages} pages, quota left ${r.quotaRemaining}`);
  }
  const gen = makeGemini({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL, fallbackModel: process.env.GEMINI_FALLBACK_MODEL });

  let t = Date.now();
  const { results } = await classifyProducts(pool, gen);
  console.log(`CLASSIFY ${((Date.now() - t) / 1000).toFixed(1)}s`);
  const candidates: ClassifiedProduct[] = pool.flatMap((p) => {
    const c = results.get(p.id)!;
    return c.categories.length ? [{ ...p, categories: c.categories, categorySource: c.source, categoryReason: c.reason }] : [];
  });
  console.log(`CANDIDATES ${candidates.length} of ${pool.length}`);

  const stage1 = rankByPriority(candidates, new Map(), "balanced").slice(0, 40);
  t = Date.now();
  const fits = await rateFit(stage1, DEFAULT_PRODUCT_TEXT, gen);
  console.log(`FIT ${((Date.now() - t) / 1000).toFixed(1)}s: rated ${fits.size} of ${stage1.length}`);
  const ranked = rankByPriority(candidates, fits, "balanced");
  const top = ranked.slice(0, 20);

  t = Date.now();
  const outreach = await writeOutreach(
    top.map((p) => ({ ...p, fit: p.fitInfo?.fit ?? null, founderName: p.founder.visibleMakers[0]?.name ?? null })),
    DEFAULT_PRODUCT_TEXT,
    gen,
  );
  console.log(`OUTREACH ${((Date.now() - t) / 1000).toFixed(1)}s: AI ${[...outreach.values()].filter((o) => o.source === "gemini").length} of ${top.length}`);

  for (const p of top) {
    const o = outreach.get(p.id)!;
    const parts = PRIORITY_KEYS.map((k) => `${k}=${p.priority.parts[k].points.toFixed(1)}`).join(" ");
    console.log(`\n#${p.rank} ${p.name} | priority ${p.priority.total} (${parts}) | ${p.categories.map((c) => CATEGORY_LABELS[c]).join("+")} | fit ${p.fitInfo?.fit} | evidence ${p.evidenceCount}/5`);
    console.log(`   tagline: ${p.tagline}`);
    console.log(`   founder: ${p.founder.label} | votes ${p.upvotes} maker ${p.makerComments} | day ${p.daysSinceLaunch}`);
    console.log(`   relevance: ${p.fitInfo?.relevance}`);
    console.log(`   [${o.source}] connection: ${o.connection}`);
    console.log(`   hypothesis: ${o.hypothesis}`);
    console.log(`   message: ${o.message}`);
    console.log(`   question: ${o.question}`);
    console.log(`   caveat: ${o.caveat}`);
  }
  writeFileSync(path.join(dir, "review.json"), JSON.stringify({ top: top.map((p) => ({ n: p.name, fit: p.fitInfo, o: outreach.get(p.id) })) }));
});
