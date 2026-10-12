// Shared storage for the cache, the saved last real result and the refresh lock.
// Production uses Upstash Redis (Vercel Marketplace) over its plain HTTPS interface, so there is no
// extra package. Without Redis settings the app falls back to memory, which still works but is only
// shared inside one server instance, so the page says "memory" in the run details.
export type Store = {
  kind: "redis" | "memory";
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Sets the key only if it does not exist. True means this caller now holds it (the lock). */
  setNX(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
  mget<T>(keys: string[]): Promise<Array<T | null>>;
  mset(entries: Array<[string, unknown]>, ttlSeconds: number): Promise<void>;
};

const parse = <T>(raw: unknown): T | null => {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export function createMemoryStore(now: () => number = Date.now): Store {
  const data = new Map<string, { value: string; expires: number | null }>();
  const read = (key: string) => {
    const e = data.get(key);
    if (!e) return null;
    if (e.expires !== null && e.expires <= now()) {
      data.delete(key);
      return null;
    }
    return e.value;
  };
  const write = (key: string, value: unknown, ttl?: number) =>
    data.set(key, { value: JSON.stringify(value), expires: ttl ? now() + ttl * 1000 : null });

  return {
    kind: "memory",
    async get<T>(key: string) {
      return parse<T>(read(key));
    },
    async set(key, value, ttl) {
      write(key, value, ttl);
    },
    async del(key) {
      data.delete(key);
    },
    async setNX(key, value, ttl) {
      if (read(key) !== null) return false;
      write(key, value, ttl);
      return true;
    },
    async mget<T>(keys: string[]) {
      return keys.map((k) => parse<T>(read(k)));
    },
    async mset(entries, ttl) {
      for (const [k, v] of entries) write(k, v, ttl);
    },
  };
}

type Redis = { url: string; token: string; fetchImpl?: typeof fetch };

export function createRedisStore({ url, token, fetchImpl = fetch }: Redis): Store {
  const base = url.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function post(path: string, body: unknown): Promise<unknown> {
    const res = await fetchImpl(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
    if (!res.ok) throw new Error(`Storage answered with status ${res.status}.`); // never echo the URL or token
    return res.json();
  }
  const command = async (args: Array<string | number>) => {
    const out = (await post("", args)) as { result?: unknown; error?: string };
    if (out.error) throw new Error("Storage rejected a command.");
    return out.result;
  };
  const pipeline = async (commands: Array<Array<string | number>>) => {
    const out = (await post("/pipeline", commands)) as Array<{ result?: unknown; error?: string }>;
    if (out.some((o) => o.error)) throw new Error("Storage rejected a command.");
    return out.map((o) => o.result);
  };

  return {
    kind: "redis",
    async get<T>(key: string) {
      return parse<T>(await command(["GET", key]));
    },
    async set(key, value, ttl) {
      await command(ttl ? ["SET", key, JSON.stringify(value), "EX", ttl] : ["SET", key, JSON.stringify(value)]);
    },
    async del(key) {
      await command(["DEL", key]);
    },
    async setNX(key, value, ttl) {
      return (await command(["SET", key, JSON.stringify(value), "EX", ttl, "NX"])) === "OK";
    },
    async mget<T>(keys: string[]) {
      if (keys.length === 0) return [];
      const out = (await command(["MGET", ...keys])) as unknown[];
      return out.map((v) => parse<T>(v));
    },
    async mset(entries, ttl) {
      if (entries.length === 0) return;
      await pipeline(entries.map(([k, v]) => ["SET", k, JSON.stringify(v), "EX", ttl]));
    },
  };
}

let shared: Store | null = null;

/** The store for this server instance: Redis when its settings exist, otherwise memory. */
export function getStore(env: Record<string, string | undefined> = process.env): Store {
  if (shared) return shared;
  // Vercel's Upstash integration injects KV_REST_API_*; Upstash's own naming is UPSTASH_REDIS_REST_*.
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  shared = url && token ? createRedisStore({ url, token }) : createMemoryStore();
  return shared;
}

/**
 * A store that never throws: a storage outage must not take the page down, so reads become misses
 * and writes are skipped. (If storage is down the live run still works; the bundled snapshot is the
 * last layer before an error.)
 */
export function safeStore(store: Store): Store {
  const guard = <A extends unknown[], R>(fn: (...a: A) => Promise<R>, fallback: R) =>
    async (...a: A): Promise<R> => {
      try {
        return await fn(...a);
      } catch {
        return fallback;
      }
    };
  return {
    kind: store.kind,
    get: guard(store.get.bind(store), null) as Store["get"],
    set: guard(store.set.bind(store), undefined),
    del: guard(store.del.bind(store), undefined),
    // If the lock cannot be asked for, proceed rather than showing an error while live data is available.
    setNX: guard(store.setNX.bind(store), true),
    mget: (async (keys: string[]) => {
      try {
        return await store.mget(keys);
      } catch {
        return keys.map(() => null);
      }
    }) as Store["mget"],
    mset: guard(store.mset.bind(store), undefined),
  };
}
