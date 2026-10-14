// Kavya's own decisions about each launch: shortlisted, contacted, and a private note. Stored per
// "workspace" (a random id kept in her browser). The id is a capability token, not a login: anyone who
// has it can read and change that workspace, and nobody else can guess it.
import { isProductHuntUrl } from "./pool";
import type { Store } from "./store";

export type DecisionStatus = "none" | "shortlisted" | "contacted";
export const STATUSES: DecisionStatus[] = ["none", "shortlisted", "contacted"];

export type Decision = {
  productId: string;
  /** Kept with the decision so the pipeline view still makes sense after the launch leaves the 7-day list. */
  name: string;
  url: string;
  status: DecisionStatus;
  note: string;
  updatedAt: string;
};

export const MAX_NOTE = 1000;
export const MAX_DECISIONS = 300;
export const MAX_NAME = 120;

const WORKSPACE = /^[a-f0-9-]{16,64}$/;
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const isWorkspaceId = (v: unknown): v is string => typeof v === "string" && WORKSPACE.test(v);
// One row per decision, so two saves to different products can never overwrite each other.
export const decisionPrefix = (workspace: string) => `ps:v2:dec:${workspace}:`;
export const decisionKey = (workspace: string, productId: string) => `${decisionPrefix(workspace)}${productId}`;

export type DecisionUpdate = { productId?: unknown; name?: unknown; url?: unknown; status?: unknown; note?: unknown };
export type UpdateResult = { ok: true; all: Record<string, Decision>; decision: Decision | null } | { ok: false; error: string };

const cleanText = (v: unknown, max: number) =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]+/g, " ")
    .trim()
    .slice(0, max);

/** Applies one change to a workspace's decisions. Pure: returns the new set, never touches storage. */
export function applyUpdate(current: Record<string, Decision>, u: DecisionUpdate, now: Date): UpdateResult {
  if (typeof u.productId !== "string" || !PRODUCT_ID.test(u.productId)) return { ok: false, error: "Unknown product." };
  const id = u.productId;
  const existing = current[id];
  if (u.status !== undefined && !STATUSES.includes(u.status as DecisionStatus)) return { ok: false, error: "Unknown status." };
  if (u.note !== undefined && typeof u.note !== "string") return { ok: false, error: "The note must be text." };

  const name = cleanText(u.name, MAX_NAME) || existing?.name || "";
  const url = typeof u.url === "string" && isProductHuntUrl(u.url) ? u.url : existing?.url || "";
  if (!existing && (!name || !url)) return { ok: false, error: "A new decision needs the product name and its Product Hunt link." };
  if (!existing && Object.keys(current).length >= MAX_DECISIONS) return { ok: false, error: "Too many saved decisions. Remove some first." };

  const next: Decision = {
    productId: id,
    name,
    url,
    status: (u.status as DecisionStatus | undefined) ?? existing?.status ?? "none",
    note: u.note !== undefined ? cleanText(u.note, MAX_NOTE) : existing?.note ?? "",
    updatedAt: now.toISOString(),
  };
  const all = { ...current };
  // A product with no status and no note carries no decision, so it is removed rather than kept as clutter.
  if (next.status === "none" && !next.note) delete all[id];
  else all[id] = next;
  return { ok: true, all, decision: all[id] ?? null };
}

export async function loadDecisions(store: Store, workspace: string): Promise<Record<string, Decision>> {
  const rows = await store.list<Decision>(decisionPrefix(workspace));
  return Object.fromEntries(rows.map(([, d]) => [d.productId, d]));
}

/** Writes (or removes) only the one product that changed. A decision is kept until Kavya changes it. */
export async function saveDecision(store: Store, workspace: string, productId: string, decision: Decision | null): Promise<void> {
  if (decision) await store.set(decisionKey(workspace, productId), decision);
  else await store.del(decisionKey(workspace, productId));
}
