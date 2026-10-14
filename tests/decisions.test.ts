import { beforeEach, describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/decisions/route";
import { applyUpdate, isWorkspaceId, MAX_DECISIONS, MAX_NOTE, type Decision } from "@/lib/decisions";
import { loadAll, saveOne, workspaceId, type KeyValue } from "@/lib/decisionsClient";

const NOW = new Date("2026-10-14T10:00:00Z");
const URL1 = "https://www.producthunt.com/products/tasklane";
const first = (u: Record<string, unknown>, current: Record<string, Decision> = {}) => applyUpdate(current, { productId: "11", name: "TaskLane", url: URL1, ...u }, NOW);

describe("decision rules", () => {
  it("shortlisting a new product stores it with its name, link and time", () => {
    const r = first({ status: "shortlisted" });
    expect(r.ok && r.decision).toEqual({ productId: "11", name: "TaskLane", url: URL1, status: "shortlisted", note: "", updatedAt: NOW.toISOString() });
  });
  it("status and note change independently; a later update keeps the other field", () => {
    const a = first({ status: "shortlisted" });
    const b = applyUpdate(a.ok ? a.all : {}, { productId: "11", note: "Ask about Slack" }, NOW);
    const c = applyUpdate(b.ok ? b.all : {}, { productId: "11", status: "contacted" }, NOW);
    expect(c.ok && c.decision).toMatchObject({ status: "contacted", note: "Ask about Slack", name: "TaskLane" });
  });
  it("clearing the status and the note removes the decision", () => {
    const a = first({ status: "shortlisted", note: "x" });
    const b = applyUpdate(a.ok ? a.all : {}, { productId: "11", status: "none", note: "" }, NOW);
    expect(b.ok && b.all).toEqual({});
    expect(b.ok && b.decision).toBeNull();
  });
  it.each([
    ["a missing product id", { productId: undefined, status: "shortlisted" }],
    ["a product id with odd characters", { productId: "../../x", status: "shortlisted" }],
    ["an unknown status", { productId: "11", status: "won" }],
    ["a note that is not text", { productId: "11", status: "contacted", note: 42 }],
  ])("rejects %s", (_n, u) => {
    expect(applyUpdate({}, { name: "TaskLane", url: URL1, ...u }, NOW).ok).toBe(false);
  });
  it("a new decision needs a real Product Hunt link and a name", () => {
    expect(applyUpdate({}, { productId: "11", name: "X", url: "https://evil.example/x", status: "shortlisted" }, NOW).ok).toBe(false);
    expect(applyUpdate({}, { productId: "11", url: URL1, status: "shortlisted" }, NOW).ok).toBe(false);
  });
  it("notes are cleaned and capped", () => {
    const r = first({ status: "contacted", note: "a\u0000b" + "x".repeat(5000) });
    expect(r.ok && r.decision?.note.length).toBe(MAX_NOTE);
    expect(r.ok && r.decision?.note.startsWith("a b")).toBe(true);
  });
  it("caps the number of saved decisions per workspace", () => {
    const many: Record<string, Decision> = {};
    for (let i = 0; i < MAX_DECISIONS; i++) many[`p${i}`] = { productId: `p${i}`, name: "n", url: URL1, status: "shortlisted", note: "", updatedAt: NOW.toISOString() };
    expect(applyUpdate(many, { productId: "new", name: "N", url: URL1, status: "shortlisted" }, NOW).ok).toBe(false);
    expect(applyUpdate(many, { productId: "p1", status: "contacted" }, NOW).ok).toBe(true); // existing ones can still change
  });
  it("workspace ids must be long random hex", () => {
    expect(isWorkspaceId("0123456789abcdef0123456789abcdef")).toBe(true);
    for (const bad of ["", "short", "../etc/passwd", "g".repeat(32), 12345, null]) expect(isWorkspaceId(bad)).toBe(false);
  });
});

const WS = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WS2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const put = (body: unknown) => PUT(new Request("http://x/api/decisions", { method: "PUT", body: JSON.stringify(body) }));
const get = (ws: string) => GET(new Request(`http://x/api/decisions?workspace=${ws}`));

describe("decisions endpoint (persistence of shortlist and contact status)", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  it("saves a decision and returns it on a later, separate request", async () => {
    const saved = await put({ workspace: WS, productId: "21", name: "ChatNest", url: "https://www.producthunt.com/products/chatnest", status: "shortlisted" });
    expect(saved.status).toBe(200);
    await put({ workspace: WS, productId: "21", status: "contacted", note: "Sent on Tuesday" });
    const body = await (await get(WS)).json();
    expect(body.ok).toBe(true);
    expect(body.decisions["21"]).toMatchObject({ name: "ChatNest", status: "contacted", note: "Sent on Tuesday" });
  });
  it("keeps workspaces apart", async () => {
    await put({ workspace: WS, productId: "31", name: "A", url: URL1, status: "shortlisted" });
    const other = await (await get(WS2)).json();
    expect(other.decisions).toEqual({});
  });
  it("simultaneous saves to different products are all kept (no lost updates)", async () => {
    const ws = "cccccccccccccccccccccccccccccccc";
    await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => put({ workspace: ws, productId: `5${n}`, name: `P${n}`, url: `https://www.producthunt.com/products/p${n}`, status: "shortlisted" })),
    );
    const body = await (await get(ws)).json();
    expect(Object.keys(body.decisions).sort()).toEqual(["51", "52", "53", "54", "55", "56", "57", "58"]);
  });
  it("clearing a decision removes it from storage", async () => {
    const ws = "dddddddddddddddddddddddddddddddd";
    await put({ workspace: ws, productId: "61", name: "X", url: URL1, status: "shortlisted" });
    await put({ workspace: ws, productId: "61", status: "none", note: "" });
    expect((await (await get(ws)).json()).decisions).toEqual({});
  });
  it("refuses an unknown workspace, bad JSON, bad updates and oversized bodies with plain messages", async () => {
    expect((await get("short")).status).toBe(400);
    expect((await put({ workspace: "nope", productId: "1" })).status).toBe(400);
    expect((await PUT(new Request("http://x/api/decisions", { method: "PUT", body: "{oops" }))).status).toBe(400);
    const bad = await put({ workspace: WS, productId: "1", status: "won" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Unknown status.");
    const big = await put({ workspace: WS, productId: "1", name: "x", url: URL1, status: "contacted", note: "x".repeat(6000) });
    expect(big.status).toBe(413);
  });
});

describe("decisions client (browser side)", () => {
  const memory = (): KeyValue & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };
  it("creates one workspace id and reuses it", () => {
    const s = memory();
    const a = workspaceId(s);
    expect(isWorkspaceId(a)).toBe(true);
    expect(workspaceId(s)).toBe(a);
  });
  it("still returns a usable id when browser storage is blocked", () => {
    const blocked: KeyValue = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(isWorkspaceId(workspaceId(blocked))).toBe(true);
    expect(isWorkspaceId(workspaceId(null))).toBe(true);
  });
  it("saves to the server and mirrors locally", async () => {
    const s = memory();
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => (calls.push(`${init?.method ?? "GET"} ${url}`), new Response(JSON.stringify({ ok: true })))) as typeof fetch;
    const out = await saveOne(WS, {}, { productId: "11", name: "TaskLane", url: URL1, status: "shortlisted" }, s, applyUpdate as never, fetchImpl);
    expect(out.saved).toBe("server");
    expect(out.decisions["11"].status).toBe("shortlisted");
    expect(JSON.parse(s.data["ps-decisions"])["11"].status).toBe("shortlisted");
    expect(calls).toEqual(["PUT /api/decisions"]);
  });
  it("when the server is down the change is kept in the browser and the user is told", async () => {
    const s = memory();
    const fetchImpl = (async () => { throw new Error("offline"); }) as typeof fetch;
    const out = await saveOne(WS, {}, { productId: "11", name: "TaskLane", url: URL1, status: "contacted" }, s, applyUpdate as never, fetchImpl);
    expect(out.saved).toBe("browser");
    expect(out.error).toContain("this browser only");
    expect(out.decisions["11"].status).toBe("contacted");
    const reloaded = await loadAll(WS, s, fetchImpl);
    expect(reloaded.saved).toBe("browser");
    expect(reloaded.decisions["11"].status).toBe("contacted");
  });
  it("loading merges a browser-only change with what the server has", async () => {
    const s = memory();
    s.setItem("ps-decisions", JSON.stringify({ "5": { productId: "5", name: "Local", url: URL1, status: "shortlisted", note: "", updatedAt: "2026-10-14T09:00:00Z" } }));
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: true, storage: "supabase", decisions: { "6": { productId: "6", name: "Remote", url: URL1, status: "contacted", note: "", updatedAt: "2026-10-14T09:30:00Z" } } }))) as typeof fetch;
    const r = await loadAll(WS, s, fetchImpl);
    expect(Object.keys(r.decisions).sort()).toEqual(["5", "6"]);
    expect(r.storage).toBe("supabase");
  });
  it("a refused update (bad input) changes nothing", async () => {
    const out = await saveOne(WS, {}, { productId: "11", status: "won" }, memory(), applyUpdate as never, (async () => new Response("{}")) as typeof fetch);
    expect(out.error).toBe("Unknown status.");
    expect(out.decisions).toEqual({});
  });
});
