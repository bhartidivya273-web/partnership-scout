// Warm-up and snapshot: runs the whole pipeline once on REAL data (live Product Hunt and Gemini),
// then saves the real result with its time to data/last-good-snapshot.json. That file is the last
// layer before the error screen, so the public link always has real, labelled data to show.
// Run: npx vitest run -c vitest.live.config.mts scripts/snapshot.live.ts
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import type { Bundle } from "@/lib/bundle";
import { CATEGORY_KEYS } from "@/lib/categories";
import { getDeps } from "@/lib/runtime";
import { KEY, runScout } from "@/lib/scout";
import { createMemoryStore } from "@/lib/store";

it("write the snapshot from a real live run", async () => {
  const store = createMemoryStore();
  const result = await runScout({ categories: [...CATEGORY_KEYS] }, { ...getDeps(process.env), store, snapshot: null });
  if (result.source !== "live") throw new Error(`expected a live run, got ${result.source}`);
  if (result.notes.some((n) => n !== "refresh_throttled")) throw new Error(`run had notes: ${result.notes.join(", ")}; not saving a degraded snapshot`);
  const bundle = await store.get<Bundle>(KEY.last);
  if (!bundle) throw new Error("no saved bundle to export");
  writeFileSync("data/last-good-snapshot.json", JSON.stringify(bundle));
  console.log(
    `SNAPSHOT written: fetchedAt=${bundle.fetchedAt} products=${bundle.products.length} classified=${Object.keys(bundle.classifications).length} fits=${Object.keys(bundle.fits).length} outreach=${Object.keys(bundle.outreach).length} outreachMethod=${result.run.outreachMethod} seconds=${result.run.seconds}`,
  );
});
