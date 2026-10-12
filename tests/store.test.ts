import { describe, expect, it } from "vitest";
import { createMemoryStore, createSupabaseStore, safeStore, type Store } from "@/lib/store";

describe("memory store", () => {
  it("stores and returns values, and returns null for unknown keys", async () => {
    const s = createMemoryStore();
    await s.set("a", { x: 1 });
    expect(await s.get("a")).toEqual({ x: 1 });
    expect(await s.get("nope")).toBeNull();
  });

  it("expires values after their time to live", async () => {
    let t = 1_000_000;
    const s = createMemoryStore(() => t);
    await s.set("a", 1, 10);
    await s.set("forever", 2);
    t += 9_000;
    expect(await s.get("a")).toBe(1);
    t += 2_000;
    expect(await s.get("a")).toBeNull();
    expect(await s.get("forever")).toBe(2); // the saved last result never expires
  });

  it("setNX gives the lock to exactly one caller, and again after it expires", async () => {
    let t = 0;
    const s = createMemoryStore(() => t);
    expect(await s.setNX("lock", 1, 5)).toBe(true);
    expect(await s.setNX("lock", 1, 5)).toBe(false);
    t += 6_000;
    expect(await s.setNX("lock", 1, 5)).toBe(true);
  });

  it("mget and mset handle several keys at once", async () => {
    const s = createMemoryStore();
    await s.mset([["a", 1], ["b", 2]], 60);
    expect(await s.mget(["a", "x", "b"])).toEqual([1, null, 2]);
  });
});

describe("Supabase store (one table through Supabase's web interface)", () => {
  type Row = { key: string; value: unknown; expires_at: string | null };

  /** A tiny stand-in for the table that understands the few requests the store makes. */
  function fakeSupabase() {
    const table = new Map<string, Row>();
    const sent: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method: String(init.method), url, headers, body });
      const q = new URL(url).searchParams;
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
      if (init.method === "GET") {
        const f = q.get("key") ?? "";
        const keys = f.startsWith("eq.") ? [f.slice(3)] : f.slice(4, -1).split(",").map((k) => k.replace(/^"|"$/g, ""));
        return json(keys.flatMap((k) => (table.has(k) ? [table.get(k)] : [])));
      }
      if (init.method === "DELETE") {
        const k = (q.get("key") ?? "").slice(3);
        const lt = q.get("expires_at");
        const r = table.get(k);
        if (r && (!lt || (r.expires_at && r.expires_at < lt.slice(3)))) table.delete(k);
        return new Response(null, { status: 204 });
      }
      const rows = body as Row[];
      if (headers.Prefer?.includes("ignore-duplicates")) {
        const made = rows.filter((r) => !table.has(r.key));
        made.forEach((r) => table.set(r.key, r));
        return json(made, 201);
      }
      rows.forEach((r) => table.set(r.key, r));
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    return { sent, table, fetchImpl };
  }
  const make = (clock = () => 1_000_000_000_000) => {
    const f = fakeSupabase();
    return { ...f, store: createSupabaseStore({ url: "https://proj.supabase.co/", serviceKey: "svc-key", fetchImpl: f.fetchImpl, now: clock }) };
  };

  it("sends the service key in headers and round-trips values", async () => {
    const { store, sent } = make();
    await store.set("ps:v1:cat:gemini-3.8-flash:12", { a: 1 }, 60);
    expect(await store.get("ps:v1:cat:gemini-3.8-flash:12")).toEqual({ a: 1 });
    expect(sent[0].url).toBe("https://proj.supabase.co/rest/v1/scout_cache?on_conflict=key");
    expect(sent[0].headers.apikey).toBe("svc-key");
    expect(sent[0].headers.Authorization).toBe("Bearer svc-key");
    expect(sent[0].headers.Prefer).toBe("resolution=merge-duplicates");
    expect(await store.get("missing")).toBeNull();
  });

  it("values with a time to live expire; values without one never do", async () => {
    let t = 1_000_000_000_000;
    const { store } = make(() => t);
    await store.set("a", 1, 10);
    await store.set("forever", 2);
    t += 9_000;
    expect(await store.get("a")).toBe(1);
    t += 2_000;
    expect(await store.get("a")).toBeNull();
    expect(await store.get("forever")).toBe(2);
  });

  it("setNX gives the lock to exactly one caller, and again once it has expired", async () => {
    let t = 1_000_000_000_000;
    const { store } = make(() => t);
    expect(await store.setNX("lock", 1, 130)).toBe(true);
    expect(await store.setNX("lock", 1, 130)).toBe(false);
    t += 131_000;
    expect(await store.setNX("lock", 1, 130)).toBe(true);
  });

  it("three simultaneous setNX calls produce exactly one winner", async () => {
    const { store } = make();
    const wins = await Promise.all([store.setNX("lock", 1, 130), store.setNX("lock", 1, 130), store.setNX("lock", 1, 130)]);
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  it("del removes a key", async () => {
    const { store } = make();
    await store.set("k", 1);
    await store.del("k");
    expect(await store.get("k")).toBeNull();
  });

  it("mget keeps the order of the keys and returns null for unknown ones, even with odd characters", async () => {
    const { store } = make();
    await store.mset([["ps:v1:a.b", 1], ["ps:v1:c", 2]], 100);
    expect(await store.mget(["ps:v1:c", "x", "ps:v1:a.b"])).toEqual([2, null, 1]);
    expect(await store.mget([])).toEqual([]);
  });

  it("mset writes many keys in one request", async () => {
    const { store, sent } = make();
    await store.mset([["a", 1], ["b", 2], ["c", 3]], 100);
    expect(sent).toHaveLength(1);
    expect((sent[0].body as Row[]).map((r) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("stores a large saved result (hundreds of KB) as one value", async () => {
    const { store } = make();
    const big = { products: Array.from({ length: 250 }, (_, i) => ({ id: i, text: "x".repeat(1200) })) };
    await store.set("big", big);
    expect(await store.get<typeof big>("big")).toEqual(big);
  });

  it("errors never contain the key or the address", async () => {
    const fetchImpl = (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch;
    const store = createSupabaseStore({ url: "https://secret-host.supabase.co", serviceKey: "super-secret-key", fetchImpl });
    const err = (await store.get("k").catch((e) => e)) as Error;
    expect(err.message).not.toContain("super-secret-key");
    expect(err.message).not.toContain("secret-host");
  });
});

describe("safeStore", () => {
  const broken: Store = {
    kind: "supabase",
    get: async () => {
      throw new Error("down");
    },
    set: async () => {
      throw new Error("down");
    },
    del: async () => {
      throw new Error("down");
    },
    setNX: async () => {
      throw new Error("down");
    },
    mget: async () => {
      throw new Error("down");
    },
    mset: async () => {
      throw new Error("down");
    },
  };
  it("turns a storage outage into misses and skipped writes instead of errors", async () => {
    const s = safeStore(broken);
    expect(await s.get("k")).toBeNull();
    await expect(s.set("k", 1)).resolves.toBeUndefined();
    expect(await s.mget(["a", "b"])).toEqual([null, null]);
    await expect(s.mset([["a", 1]], 5)).resolves.toBeUndefined();
  });
  it("lets a run continue when the lock cannot be asked for", async () => {
    expect(await safeStore(broken).setNX("lock", 1, 5)).toBe(true);
  });
});
