"use client";

// The interactive workspace: controls, honest progress, ranked results, detail dialog and saved decisions.
import { useRef, useState } from "react";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/categories";
import { COPY } from "@/lib/copy";
import { applyUpdate, type Decision, type DecisionStatus } from "@/lib/decisions";
import { loadAll, saveOne, workspaceId } from "@/lib/decisionsClient";
import { ageText, createLineParser, formatDate, formatDateTime, minutesAgo } from "@/lib/format";
import { DEFAULT_PRODUCT_TEXT } from "@/lib/input";
import { DEFAULT_PRESET, type PresetName } from "@/lib/priority";
import type { ResultItem, ScoutEvent, ScoutResult, Step } from "@/lib/result";
import { NO_FILTERS, type Filters, type SortMode } from "@/lib/workspace";
import { Controls } from "./ui/Controls";
import { Detail, type SaveInfo } from "./ui/Detail";
import { Results } from "./ui/Results";
import { RunDetails } from "./ui/RunDetails";
import { Status } from "./ui/Status";
import { useNow } from "./ui/useNow";

type View =
  | { kind: "idle" }
  | { kind: "loading"; step: Step | null }
  | { kind: "done"; result: ScoutResult; receivedAt: number }
  | { kind: "error"; message: string };

const STEP_TEXT: Record<Step, string> = { fetch: COPY.PROG_1, categorize: COPY.PROG_2, rank: COPY.PROG_3, fit: COPY.PROG_FIT, outreach: COPY.PROG_4 };

const browserStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked by the browser: everything still works for this visit
  }
};

export default function Scout() {
  const [selected, setSelected] = useState<CategoryKey[]>([...CATEGORY_KEYS]);
  const [productText, setProductText] = useState<string>(DEFAULT_PRODUCT_TEXT);
  const [preset, setPreset] = useState<PresetName>(DEFAULT_PRESET);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [sort, setSort] = useState<SortMode>("priority");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [grouped, setGrouped] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [saveInfo, setSaveInfo] = useState<SaveInfo>({ saved: "server", storage: "supabase", error: null });
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(15_000);
  const running = view.kind === "loading";
  // A ref (not state) so a second click in the same instant is ignored before the page redraws.
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggle = (k: CategoryKey) => setSelected((cur) => (cur.includes(k) ? cur.filter((c) => c !== k) : [...cur, k]));

  async function run(options: { refresh?: boolean; preset?: PresetName } = {}) {
    if (busy.current || selected.length === 0) return;
    busy.current = true;
    const started = Date.now();
    setElapsed(0);
    setView({ kind: "loading", step: null });
    // One generic timer rather than invented steps: the step text only changes when the server says so.
    timer.current = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    let finished = false;
    try {
      const res = await fetch("/api/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: selected, productText, preset: options.preset ?? preset, refresh: options.refresh === true }),
      });
      if (!res.ok || !res.body) throw new Error("bad response");
      const parser = createLineParser((line) => {
        const e = JSON.parse(line) as ScoutEvent;
        if (e.type === "step") {
          setView({ kind: "loading", step: e.step });
        } else if (e.type === "result") {
          finished = true;
          setView({ kind: "done", result: e.result, receivedAt: Date.now() });
        } else {
          finished = true;
          setView({ kind: "error", message: e.message });
        }
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.end();
      if (!finished) throw new Error("stream ended early");
      void loadSaved();
    } catch {
      setView({ kind: "error", message: COPY.ERR_GENERIC });
    } finally {
      if (timer.current) clearInterval(timer.current);
      busy.current = false;
    }
  }

  async function loadSaved() {
    const loaded = await loadAll(workspaceId(browserStorage()), browserStorage());
    setDecisions(loaded.decisions);
    setSaveInfo({ saved: loaded.saved, storage: loaded.storage, error: loaded.saved === "browser" ? "Saved decisions could not be loaded from the server; showing this browser's copy." : null });
  }

  async function update(item: ResultItem, patch: { status?: DecisionStatus; note?: string }) {
    const out = await saveOne(
      workspaceId(browserStorage()),
      decisions,
      { productId: item.id, name: item.name, url: item.productHuntUrl, ...patch },
      browserStorage(),
      applyUpdate,
    );
    setDecisions(out.decisions);
    setSaveInfo((cur) => ({ saved: out.saved, storage: out.saved === "server" ? (cur.storage === "browser" ? "supabase" : cur.storage) : "browser", error: out.error }));
  }

  const toggleShortlist = (item: ResultItem) =>
    update(item, { status: decisions[item.id]?.status === "shortlisted" ? "none" : "shortlisted" });

  const done = view.kind === "done" ? view : null;
  const result = done?.result ?? null;
  const openItem = result?.items.find((i) => i.id === openId) ?? null;

  // A forced refresh is allowed once the data is 5 minutes old (this protects Product Hunt's shared limit).
  const waitSeconds = result && done && now > 0 ? Math.max(0, result.refreshAfterSeconds - Math.max(0, Math.floor((now - done.receivedAt) / 1000))) : 0;
  const refreshHint = result && waitSeconds > 0 ? `Refresh is available in about ${Math.ceil(waitSeconds / 60)} min (protects Product Hunt's shared limit).` : "";
  const windowText = result ? `${formatDate(result.windowStart)} to ${formatDate(result.windowEnd)}: the last 7 days, UTC` : "the last 7 days (UTC)";
  const updatedText = result ? `Data updated ${formatDateTime(result.dataAsOf)}${now > 0 ? ` (${ageText(minutesAgo(result.dataAsOf, new Date(now)))} ago)` : ""}` : null;

  return (
    <>
      <Controls
        selected={selected}
        onToggle={toggle}
        productText={productText}
        onProductText={setProductText}
        preset={preset}
        onPreset={(p) => {
          setPreset(p);
          if (done) void run({ preset: p }); // re-ranks the cached pool: no new Product Hunt request
        }}
        running={running}
        onRun={() => void run()}
        onRefresh={() => void run({ refresh: true })}
        canRefresh={Boolean(result) && waitSeconds === 0}
        refreshHint={refreshHint}
        windowText={windowText}
        updatedText={updatedText}
      />

      <div className="results" aria-busy={running}>
        <div role="status" aria-live="polite">
          {view.kind === "loading" && (
            <p className="progress">
              <span className="spinner" aria-hidden="true" /> {view.step ? STEP_TEXT[view.step] : COPY.PROG_START} <span className="muted">({elapsed}s)</span>
            </p>
          )}
          {result && <Status result={result} now={now} />}
        </div>

        {view.kind === "idle" && (
          <section className="initial">
            <h2>{COPY.INITIAL_TITLE}</h2>
            <p>{COPY.INITIAL_BODY}</p>
          </section>
        )}

        {view.kind === "loading" && (
          <ul className="rows" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="row skeleton" />
            ))}
          </ul>
        )}

        {view.kind === "error" && (
          <div className="error" role="alert">
            <p>{view.message}</p>
            {view.message !== COPY.HINT_CATEGORY && (
              <button type="button" className="secondary" onClick={() => void run()}>
                {COPY.BTN_RETRY}
              </button>
            )}
          </div>
        )}

        {result && result.items.length === 0 && (
          <p className="empty">
            {result.scanned > 0
              ? `No featured launches in your categories in the last 7 days (${result.scanned} launches were checked). Try switching on more categories.`
              : COPY.EMPTY_RESULTS}
          </p>
        )}

        {result && result.items.length > 0 && (
          <>
            <Results
              result={result}
              decisions={decisions}
              sort={sort}
              setSort={setSort}
              filters={filters}
              setFilters={setFilters}
              grouped={grouped}
              setGrouped={setGrouped}
              onOpen={setOpenId}
              onToggleShortlist={(i) => void toggleShortlist(i)}
            />
            <RunDetails result={result} />
          </>
        )}
      </div>

      {result && openItem && (
        <Detail
          key={openItem.id}
          item={openItem}
          result={result}
          decision={decisions[openItem.id]}
          saveInfo={saveInfo}
          candidates={result.inCategories}
          onClose={() => setOpenId(null)}
          onUpdate={(i, patch) => void update(i, patch)}
        />
      )}
    </>
  );
}
