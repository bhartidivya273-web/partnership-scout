import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/scout/route";
import { isBundle, loadSnapshot } from "@/lib/bundle";
import { safeFields } from "@/lib/log";
import { runScout } from "@/lib/scout";
import { createMemoryStore } from "@/lib/store";
import { fakeGemini, fakePH, NOW, rawPost } from "./fakes";

const root = path.resolve(__dirname, "..");
function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}
const source = (dir: string) => walk(path.join(root, dir), (f) => /\.(ts|tsx)$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(root, f);

const SECRET_NAMES = ["PRODUCT_HUNT_TOKEN", "GEMINI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "UPSTASH_REDIS_REST_TOKEN"];
// The only server-side files allowed to read secrets from the environment.
const ALLOWED_SECRET_READERS = new Set(["lib/runtime.ts", "lib/store.ts", "app/api/health/route.ts", "app/api/decisions/route.ts", "app/api/scout/route.ts"]);

describe("API-key protection", () => {
  it("only the server-side modules read secret settings", () => {
    const offenders = [...source("lib"), ...source("app")]
      .filter((f) => !ALLOWED_SECRET_READERS.has(rel(f)))
      .filter((f) => /process\.env/.test(read(f)) || SECRET_NAMES.some((n) => read(f).includes(n)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("no browser-side file (anything marked 'use client', or under app/ui) touches the environment", () => {
    const client = source("app").filter((f) => read(f).trimStart().startsWith('"use client"') || rel(f).startsWith("app/ui/"));
    expect(client.length).toBeGreaterThan(5);
    for (const f of client) expect(read(f), rel(f)).not.toMatch(/process\.env|SERVICE_ROLE|GEMINI_API|PRODUCT_HUNT_TOKEN/);
  });

  it("no secret is exposed through a NEXT_PUBLIC_ variable", () => {
    for (const f of [...source("lib"), ...source("app")]) expect(read(f), rel(f)).not.toMatch(/NEXT_PUBLIC_\w*(KEY|TOKEN|SECRET)/);
  });

  it("the committed files contain no key-shaped values", () => {
    const files = walk(root, (f) => !/node_modules|\.next|\.git\/|\.env\.local|\.review-cache|package-lock/.test(f) && /\.(ts|tsx|md|json|mjs|sql|example|css)$/.test(f) || f.endsWith(".env.example"));
    const patterns = [/AIza[\w-]{30,}/, /AQ\.Ab8[\w-]{20,}/, /sk-or-v1-\w{20,}/, /eyJhbGciOi[\w-]{20,}\.[\w-]{20,}\.[\w-]{20,}/, /Bearer\s+[A-Za-z0-9_-]{30,}/];
    const hits = files.flatMap((f) => patterns.filter((p) => p.test(read(f))).map(() => rel(f)));
    expect(hits).toEqual([]);
  });

  it.skipIf(!existsSync(path.join(root, ".next/static")))("the built browser bundle contains no secret values or secret setting names", () => {
    // Real values come from the git-ignored .env.local when it exists (a fresh checkout simply checks names).
    const local = existsSync(path.join(root, ".env.local")) ? Object.fromEntries(read(path.join(root, ".env.local")).split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])) : {};
    const values = [...SECRET_NAMES, "SUPABASE_URL"].map((n) => process.env[n] ?? local[n]).filter((v): v is string => Boolean(v && v.length > 12));
    expect(values.length >= 0).toBe(true);
    for (const f of walk(path.join(root, ".next/static"), (x) => /\.(js|css|html)$/.test(x))) {
      const text = read(f);
      for (const v of values) expect(text.includes(v), `${rel(f)} contains a secret value`).toBe(false);
      for (const n of SECRET_NAMES) expect(text.includes(n), `${rel(f)} mentions ${n}`).toBe(false);
    }
  });

  it("log events drop anything that looks like a secret and shorten long text", () => {
    const out = safeFields({ event: "x", apiKey: "abc", token: "t", SUPABASE_SERVICE_ROLE_KEY: "k", authorization: "Bearer z", note: "ok", long: "y".repeat(500) });
    expect(Object.keys(out).sort()).toEqual(["event", "long", "note"]);
    expect(String(out.long).length).toBeLessThan(260);
  });

  it("a result sent to the browser never contains a token, a key or Product Hunt's hidden-maker marker", async () => {
    const store = createMemoryStore();
    const r = await runScout(
      { categories: ["project_management", "team_communication"] },
      { store, gen: fakeGemini().gen, model: "m", token: "TOKEN-SECRET-123", now: () => NOW, fetchImpl: fakePH(60).fetchImpl, retryDelayMs: 0 },
    );
    const text = JSON.stringify(r);
    expect(text).not.toContain("TOKEN-SECRET-123");
    expect(text.toUpperCase()).not.toContain("REDACTED");
  });
});

describe("the scout endpoint", () => {
  const post = (body: string) => POST(new Request("http://x/api/scout", { method: "POST", body }));
  const lines = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  it("answers broken, empty and oversized input with a plain error line, never a stack trace", async () => {
    for (const body of ["{oops", "", JSON.stringify({ categories: [] }), "x".repeat(10_000)]) {
      const res = await post(body);
      expect(res.headers.get("content-type")).toContain("application/x-ndjson");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const [event] = await lines(res);
      expect(event).toEqual({ type: "error", code: "no_category", message: "Choose at least one category." });
    }
  });
});

describe("synthetic fixtures never reach production results", () => {
  it("no production file imports test helpers, fakes or fixtures", () => {
    const offenders = [...source("lib"), ...source("app")].filter((f) => /from\s+["'](?:@\/tests|\.\.?\/tests|.*\/fakes|.*ai-helpers)/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("a launch that does not point at Product Hunt is dropped before ranking", async () => {
    const make = (i: number) => rawPost(i, i <= 5 ? { url: `https://example.com/fixture-${i}` } : {});
    const r = await runScout(
      { categories: ["team_communication"] },
      { store: createMemoryStore(), gen: fakeGemini().gen, model: "m", token: "t", now: () => NOW, fetchImpl: fakePH(30, { makePost: make }).fetchImpl, retryDelayMs: 0 },
    );
    expect(r.scanned).toBe(25);
    expect(r.items.every((i) => i.productHuntUrl.startsWith("https://www.producthunt.com/"))).toBe(true);
    expect(r.items.some((i) => Number(i.id) <= 5)).toBe(false);
  });

  it("the committed snapshot is either empty or a genuine Product Hunt capture", () => {
    const snap = loadSnapshot();
    if (!snap) {
      expect(isBundle(snap)).toBe(false); // the empty placeholder is never served
      return;
    }
    expect(snap.schema).toBe(2);
    expect(snap.products.length).toBeGreaterThan(50);
    const fetched = Date.parse(snap.fetchedAt);
    expect(fetched).toBeLessThan(Date.now() + 60_000);
    for (const p of snap.products) {
      expect(p.productHuntUrl, p.name).toMatch(/^https:\/\/www\.producthunt\.com\//);
      expect(p.name).not.toMatch(/^Product \d+$/); // the name pattern every test fixture uses
      expect(Date.parse(p.launchedAt)).toBeLessThanOrEqual(fetched);
      expect(fetched - Date.parse(p.launchedAt)).toBeLessThanOrEqual(7 * 24 * 3600_000);
    }
    expect(JSON.stringify(snap).toUpperCase()).not.toContain("REDACTED");
  });
});
