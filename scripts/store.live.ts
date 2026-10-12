// Proves the Supabase store against the REAL database: values, expiry, the one-winner lock and
// batches. Uses throw-away keys prefixed "test:" and removes them at the end.
// Run: npx vitest run -c vitest.live.config.mts scripts/store.live.ts
import { expect, it } from "vitest";
import { createSupabaseStore } from "@/lib/store";

it("real Supabase: values, expiry, lock race, batches", async () => {
  const store = createSupabaseStore({ url: process.env.SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY! });
  const id = `test:${Date.now()}`;
  const keys = [`${id}:a`, `${id}:b`, `${id}:lock`, `${id}:ttl`];

  await store.set(keys[0], { hello: "world", n: [1, 2, 3] });
  expect(await store.get(keys[0])).toEqual({ hello: "world", n: [1, 2, 3] });
  expect(await store.get(`${id}:missing`)).toBeNull();

  await store.mset([[keys[0], 1], [keys[1], 2]], 60);
  expect(await store.mget([keys[1], `${id}:nope`, keys[0]])).toEqual([2, null, 1]);

  const wins = await Promise.all([1, 2, 3, 4, 5].map(() => store.setNX(keys[2], 1, 30)));
  console.log("LOCK RACE: winners =", wins.filter(Boolean).length, "of", wins.length);
  expect(wins.filter(Boolean)).toHaveLength(1);
  await store.del(keys[2]);
  expect(await store.setNX(keys[2], 1, 30)).toBe(true); // free again after release

  await store.set(keys[3], "short-lived", 2);
  expect(await store.get(keys[3])).toBe("short-lived");
  await new Promise((r) => setTimeout(r, 2500));
  expect(await store.get(keys[3])).toBeNull();

  const big = { products: Array.from({ length: 250 }, (_, i) => ({ id: i, text: "x".repeat(1200) })) };
  await store.set(`${id}:big`, big);
  expect(await store.get<typeof big>(`${id}:big`)).toEqual(big);

  for (const k of [...keys, `${id}:big`]) await store.del(k);
  expect(await store.get(keys[0])).toBeNull();
  console.log("REAL SUPABASE STORE: all checks passed, test keys removed");
});
