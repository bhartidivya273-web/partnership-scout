// Saves and returns Kavya's decisions (shortlisted, contacted, notes) for one browser workspace.
// Errors are plain sentences: no stack traces, no storage details, no keys.
import { applyUpdate, isWorkspaceId, loadDecisions, saveDecision, type DecisionUpdate } from "@/lib/decisions";
import { logEvent } from "@/lib/log";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 4_000;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const workspace = new URL(request.url).searchParams.get("workspace");
  if (!isWorkspaceId(workspace)) return json({ ok: false, error: "Unknown workspace." }, 400);
  const store = getStore();
  try {
    return json({ ok: true, decisions: await loadDecisions(store, workspace), storage: store.kind });
  } catch {
    logEvent("decisions.failed", { op: "load", kind: store.kind });
    return json({ ok: false, error: "Saved decisions could not be loaded right now." }, 503);
  }
}

export async function PUT(request: Request) {
  let body: DecisionUpdate & { workspace?: unknown };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: "That request is too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "That request could not be read." }, 400);
  }
  if (!isWorkspaceId(body.workspace)) return json({ ok: false, error: "Unknown workspace." }, 400);

  const store = getStore();
  try {
    const result = applyUpdate(await loadDecisions(store, body.workspace), body, new Date());
    if (!result.ok) return json({ ok: false, error: result.error }, 400);
    await saveDecision(store, body.workspace, String(body.productId), result.decision);
    return json({ ok: true, decision: result.decision, storage: store.kind });
  } catch {
    logEvent("decisions.failed", { op: "save", kind: store.kind });
    return json({ ok: false, error: "The decision could not be saved right now." }, 503);
  }
}
