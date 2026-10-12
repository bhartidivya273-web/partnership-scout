// Quality review on REAL data (Builder_Pack/01 section 4): fetches the live pool once (cached in
// REVIEW_DIR so repeat runs cost no Product Hunt quota), then prints category labels and angles.
// Run: REVIEW_DIR=/some/folder npx vitest run -c vitest.live.config.mts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { writeAngles } from "@/lib/angles";
import { CATEGORY_LABELS } from "@/lib/categories";
import { classifyProducts } from "@/lib/classify";
import { makeGemini } from "@/lib/gemini";
import { DEFAULT_PRODUCT_TEXT } from "@/lib/input";
import { buildPool } from "@/lib/pool";
import { fetchFeaturedPosts } from "@/lib/producthunt";
import { rankPool } from "@/lib/scoring";
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

  const gen = makeGemini({
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL,
    fallbackModel: process.env.GEMINI_FALLBACK_MODEL,
  });

  let t = Date.now();
  const { results, usedFallback } = await classifyProducts(pool, gen);
  console.log(`CLASSIFY: ${((Date.now() - t) / 1000).toFixed(1)}s, fallback used: ${usedFallback}`);
  const counts: Record<string, number> = { none: 0 };
  let topicCount = 0;
  for (const c of results.values()) {
    if (c.source === "topic") topicCount++;
    if (c.categories.length === 0) counts.none++;
    for (const k of c.categories) counts[k] = (counts[k] ?? 0) + 1;
  }
  console.log("CATEGORY COUNTS", JSON.stringify(counts), "topic-sourced:", topicCount);

  const classified: ClassifiedProduct[] = pool
    .map((p) => {
      const c = results.get(p.id)!;
      return { ...p, categories: c.categories, categorySource: c.source, categoryReason: c.reason };
    })
    .filter((p) => p.categories.length > 0);
  const ranked = rankPool(classified);
  console.log(`CANDIDATES in categories: ${classified.length}`);
  console.log("TOP 20 (rank | score | votes | maker | categories | name | tagline | reason)");
  for (const p of ranked.slice(0, 20)) {
    console.log(
      [p.rank, p.score.total, p.upvotes, p.makerComments, p.categories.map((c) => CATEGORY_LABELS[c]).join("+"), p.name, `"${p.tagline}"`, p.categoryReason].join(" | "),
    );
  }

  // A sample of excluded products, to check nothing relevant was dropped.
  const excluded = pool.filter((p) => results.get(p.id)!.categories.length === 0).slice(0, 15);
  console.log("EXCLUDED SAMPLE (name | tagline | reason)");
  for (const p of excluded) console.log([p.name, `"${p.tagline}"`, results.get(p.id)!.reason].join(" | "));

  t = Date.now();
  const angles = await writeAngles(ranked.slice(0, 20), DEFAULT_PRODUCT_TEXT, gen);
  console.log(`ANGLES: ${((Date.now() - t) / 1000).toFixed(1)}s`);
  for (const p of ranked.slice(0, 20)) {
    const a = angles.get(p.id)!;
    console.log(`#${p.rank} ${p.name} [${a.angleSource}, fit ${a.fit}] ${a.angle}`);
  }
  writeFileSync(path.join(dir, "review.json"), JSON.stringify({ counts, top: ranked.slice(0, 20).map((p) => ({ n: p.name, a: angles.get(p.id) })) }));
});
