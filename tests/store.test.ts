import { describe, expect, it } from "vitest";
import { createMemoryStore, createRedisStore, safeStore, type Store } from "@/lib/store";

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

describe("Redis store (Upstash REST protocol)", () => {
  function fakeRedis() {
    const sent: Array<{ url: string; auth: string; body: unknown }> = [];
    const data = new Map<string, string>();
    const run = (cmd: Array<string | number>) => {
      const [op, key, val] = cmd as [string, string, string];
      if (op === "GET") return data.get(key) ?? null;
      if (op === "SET") {
        if (cmd.includes("NX") && data.has(key)) return null;
        data.set(key, val);
        return "OK";
      }
      if (op === "DEL") return data.delete(key) ? 1 : 0;
      if (op === "MGET") return (cmd.slice(1) as string[]).map((k) => data.get(k) ?? null);
      return null;
    };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push({ url, auth: (init.headers as Record<string, string>).Authorization, body });
      const result = url.endsWith("/pipeline") ? (body as Array<Array<string | number>>).map((c) => ({ result: run(c) })) : { result: run(body) };
      return new Response(JSON.stringify(result));
    }) as unknown as typeof fetch;
    return { sent, fetchImpl };
  }

  it("speaks the REST protocol with a bearer token and round-trips values", async () => {
    const { sent, fetchImpl } = fakeRedis();
    const s = createRedisStore({ url: "https://redis.example/", token: "tok", fetchImpl });
    await s.set("k", { a: 1 }, 60);
    expect(await s.get("k")).toEqual({ a: 1 });
    expect(sent[0].url).toBe("https://redis.example");
    expect(sent[0].auth).toBe("Bearer tok");
    expect(sent[0].body).toEqual(["SET", "k", '{"a":1}', "EX", 60]);
  });

  it("setNX uses SET ... NX so only one caller wins", async () => {
    const { fetchImpl } = fakeRedis();
    const s = createRedisStore({ url: "https://r", token: "t", fetchImpl });
    expect(await s.setNX("lock", 1, 130)).toBe(true);
    expect(await s.setNX("lock", 1, 130)).toBe(false);
  });

  it("mset goes through the pipeline endpoint with an expiry on every key", async () => {
    const { sent, fetchImpl } = fakeRedis();
    const s = createRedisStore({ url: "https://r", token: "t", fetchImpl });
    await s.mset([["a", 1], ["b", 2]], 100);
    expect(sent[0].url).toBe("https://r/pipeline");
    expect(sent[0].body).toEqual([["SET", "a", "1", "EX", 100], ["SET", "b", "2", "EX", 100]]);
    expect(await s.mget(["a", "b", "c"])).toEqual([1, 2, null]);
  });

  it("errors never contain the token or the address", async () => {
    const fetchImpl = (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch;
    const s = createRedisStore({ url: "https://secret-host.example", token: "super-secret", fetchImpl });
    const err = (await s.get("k").catch((e) => e)) as Error;
    expect(err.message).not.toContain("super-secret");
    expect(err.message).not.toContain("secret-host");
  });
});

describe("safeStore", () => {
  const broken: Store = {
    kind: "redis",
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
