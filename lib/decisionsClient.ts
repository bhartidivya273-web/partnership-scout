// Browser side of the decisions: the server is the source of truth, and a local copy in the browser keeps
// working if the network or database is down. Nothing here is secret: the workspace id is the only credential.
import { isWorkspaceId, type Decision, type DecisionUpdate } from "./decisions";

export type KeyValue = Pick<Storage, "getItem" | "setItem">;
const WS_KEY = "ps-workspace";
const LOCAL_KEY = "ps-decisions";

export function randomWorkspaceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function workspaceId(storage: KeyValue | null): string {
  try {
    const existing = storage?.getItem(WS_KEY);
    if (isWorkspaceId(existing)) return existing;
    const fresh = randomWorkspaceId();
    storage?.setItem(WS_KEY, fresh);
    return fresh;
  } catch {
    return randomWorkspaceId(); // storage blocked: this session still works, it just will not be remembered
  }
}

const readLocal = (storage: KeyValue | null): Record<string, Decision> => {
  try {
    const parsed = JSON.parse(storage?.getItem(LOCAL_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
const writeLocal = (storage: KeyValue | null, all: Record<string, Decision>) => {
  try {
    storage?.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    // a full or blocked browser store is not worth failing for
  }
};

export type Loaded = { decisions: Record<string, Decision>; saved: "server" | "browser"; storage: "supabase" | "memory" | "browser" };

export async function loadAll(ws: string, storage: KeyValue | null, fetchImpl: typeof fetch = fetch): Promise<Loaded> {
  try {
    const res = await fetchImpl(`/api/decisions?workspace=${ws}`, { cache: "no-store" });
    const body = (await res.json()) as { ok: boolean; decisions?: Record<string, Decision>; storage?: "supabase" | "memory" };
    if (!res.ok || !body.ok || !body.decisions) throw new Error("load failed");
    // Anything saved only in this browser while the server was unreachable is kept, not lost.
    const merged = { ...readLocal(storage), ...body.decisions };
    writeLocal(storage, merged);
    return { decisions: merged, saved: "server", storage: body.storage ?? "memory" };
  } catch {
    return { decisions: readLocal(storage), saved: "browser", storage: "browser" };
  }
}

export type SaveOutcome = { decisions: Record<string, Decision>; saved: "server" | "browser"; error: string | null };

/** Applies the change locally first (so the page never waits), then tries to save it on the server. */
export async function saveOne(
  ws: string,
  current: Record<string, Decision>,
  update: DecisionUpdate,
  storage: KeyValue | null,
  apply: (c: Record<string, Decision>, u: DecisionUpdate, n: Date) => { ok: boolean; all?: Record<string, Decision>; error?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SaveOutcome> {
  const local = apply(current, update, new Date());
  if (!local.ok || !local.all) return { decisions: current, saved: "browser", error: local.error ?? "Could not save." };
  writeLocal(storage, local.all);
  try {
    const res = await fetchImpl("/api/decisions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: ws, ...update }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
    return { decisions: local.all, saved: "server", error: null };
  } catch {
    return { decisions: local.all, saved: "browser", error: "Saved in this browser only: the server could not be reached." };
  }
}
