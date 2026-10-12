// Shared storage for the cache, the saved last real result and the refresh lock.
// Production uses one small Supabase table (scout_cache) through Supabase's built-in web interface,
// so there is no extra package. Without Supabase settings the app falls back to memory, which still
// works but is only shared inside one server instance, so the page says "memory" in the run details.
export type Store = {
  kind: "supabase" | "memory";
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

type Supabase = { url: string; serviceKey: string; fetchImpl?: typeof fetch; now?: () => number };

const TABLE = "scout_cache";

/**
 * The shared store, as one table: key (text, primary key), value (jsonb), expires_at (nullable).
 * The server-side service key is used, so the table is closed to everyone else (row level security
 * with no policies); the key never leaves the server.
 */
export function createSupabaseStore({ url, serviceKey, fetchImpl = fetch, now = Date.now }: Supabase): Store {
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/${TABLE}`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  async function call(query: string, init: { method: string; prefer?: string; body?: unknown }): Promise<unknown> {
    const res = await fetchImpl(`${endpoint}${query}`, {
      method: init.method,
      headers: init.prefer ? { ...headers, Prefer: init.prefer } : headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Storage answered with status ${res.status}.`); // never echo the address or key
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  type Row = { key: string; value: unknown; expires_at: string | null };
  const live = (r: Row | undefined): unknown => (r && (!r.expires_at || Date.parse(r.expires_at) > now()) ? r.value : null);
  const row = (key: string, value: unknown, ttl?: number): Row => ({
    key,
    value,
    expires_at: ttl ? new Date(now() + ttl * 1000).toISOString() : null,
  });
  const upsert = (rows: Row[]) => call("?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates", body: rows });

  return {
    kind: "supabase",
    async get<T>(key: string) {
      const rows = (await call(`?key=eq.${encodeURIComponent(key)}&select=key,value,expires_at`, { method: "GET" })) as Row[];
      return live(rows[0]) as T | null;
    },
    async set(key, value, ttl) {
      await upsert([row(key, value, ttl)]);
    },
    async del(key) {
      await call(`?key=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
    },
    async setNX(key, value, ttl) {
      // Clear the lock if it has expired, then try to insert it: the primary key lets exactly one caller win.
      await call(`?key=eq.${encodeURIComponent(key)}&expires_at=lt.${encodeURIComponent(new Date(now()).toISOString())}`, { method: "DELETE" });
      const made = (await call("?on_conflict=key", {
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=representation",
        body: [row(key, value, ttl)],
      })) as Row[] | null;
      return Array.isArray(made) && made.length === 1;
    },
    async mget<T>(keys: string[]) {
      if (keys.length === 0) return [];
      const list = keys.map((k) => `"${k.replace(/"/g, "")}"`).join(",");
      const rows = (await call(`?key=in.(${encodeURIComponent(list)})&select=key,value,expires_at`, { method: "GET" })) as Row[];
      const byKey = new Map(rows.map((r) => [r.key, r]));
      return keys.map((k) => live(byKey.get(k)) as T | null);
    },
    async mset(entries, ttl) {
      if (entries.length === 0) return;
      await upsert(entries.map(([k, v]) => row(k, v, ttl)));
    },
  };
}

let shared: Store | null = null;

/** The store for this server instance: Supabase when its settings exist, otherwise memory. */
export function getStore(env: Record<string, string | undefined> = process.env): Store {
  if (shared) return shared;
  // Vercel's Supabase integration sets SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server only).
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  shared = url && serviceKey ? createSupabaseStore({ url, serviceKey }) : createMemoryStore();
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
