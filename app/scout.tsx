"use client";

// The one interactive part of the page: controls, honest progress, status line and ranked rows.
import { useEffect, useRef, useState } from "react";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/categories";
import { bannerSaved, CATEGORY_CHIP_LABELS, COPY, statusLine } from "@/lib/copy";
import {
  breakdownParts,
  closesText,
  createLineParser,
  formatDate,
  formatDateTime,
  formatInt,
  groupByFit,
  summaryCounts,
  type FitKey,
  isClosingSoon,
  launchedText,
  minutesAgo,
  oneDecimal,
  sortRows,
  type SortMode,
} from "@/lib/format";
import { DEFAULT_PRODUCT_TEXT } from "@/lib/input";
import type { ResultItem, ScoutEvent, ScoutResult, Step } from "@/lib/result";

type View =
  | { kind: "idle" }
  | { kind: "loading"; step: Step | null }
  | { kind: "done"; result: ScoutResult }
  | { kind: "error"; message: string };

const STEP_TEXT: Record<Step, string> = { fetch: COPY.PROG_1, categorize: COPY.PROG_2, rank: COPY.PROG_3, angles: COPY.PROG_4 };
const FIT_TEXT = { strong: COPY.FIT_STRONG, partial: COPY.FIT_PARTIAL, weak: COPY.FIT_WEAK } as const;

export default function Scout() {
  const [selected, setSelected] = useState<CategoryKey[]>([...CATEGORY_KEYS]);
  const [productText, setProductText] = useState<string>(DEFAULT_PRODUCT_TEXT);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [sort, setSort] = useState<SortMode>("score");
  const [grouped, setGrouped] = useState(true);
  const running = view.kind === "loading";
  // A ref (not state) so a second click in the same instant is ignored before the page redraws.
  const busy = useRef(false);

  // One generic timer rather than invented steps: the step text only changes when the server says so.
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const toggle = (k: CategoryKey) => setSelected((cur) => (cur.includes(k) ? cur.filter((c) => c !== k) : [...cur, k]));

  async function run() {
    if (busy.current || selected.length === 0) return;
    busy.current = true;
    setElapsed(0);
    setSort("score");
    setView({ kind: "loading", step: null });
    let finished = false;
    try {
      const res = await fetch("/api/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: selected, productText }),
      });
      if (!res.ok || !res.body) throw new Error("bad response");
      const parser = createLineParser((line) => {
        const e = JSON.parse(line) as ScoutEvent;
        if (e.type === "step") {
          setView({ kind: "loading", step: e.step });
        } else if (e.type === "result") {
          finished = true;
          setView({ kind: "done", result: e.result });
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
    } catch {
      setView({ kind: "error", message: COPY.ERR_GENERIC });
    } finally {
      busy.current = false;
    }
  }

  const noneSelected = selected.length === 0;

  return (
    <>
      <section className="panel" aria-label="Search controls">
        <fieldset className="field">
          <legend className="label">{COPY.CAT_LABEL}</legend>
          <div className="chips">
            {CATEGORY_KEYS.map((k) => (
              <button key={k} type="button" className="chip" aria-pressed={selected.includes(k)} onClick={() => toggle(k)} disabled={running}>
                {CATEGORY_CHIP_LABELS[k]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label className="label" htmlFor="product">
            {COPY.PRODUCT_LABEL}
          </label>
          <textarea id="product" rows={1} maxLength={300} value={productText} onChange={(e) => setProductText(e.target.value)} disabled={running} />
          <p className="help">{COPY.PRODUCT_HELP}</p>
        </div>

        <div className="actions">
          <button type="button" className="primary" onClick={run} disabled={running || noneSelected}>
            {running ? COPY.BTN_RUNNING : COPY.BTN_RUN}
          </button>
          {noneSelected && <span className="hint">{COPY.HINT_CATEGORY}</span>}
        </div>
      </section>

      <div className="results" aria-busy={running}>
        <div role="status" aria-live="polite">
          {view.kind === "loading" && (
            <p className="progress">
              <span className="spinner" aria-hidden="true" /> {view.step ? STEP_TEXT[view.step] : COPY.PROG_START} <span className="muted">({elapsed}s)</span>
            </p>
          )}
          {view.kind === "done" && <Status result={view.result} />}
        </div>

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
              <button type="button" className="secondary" onClick={run}>
                {COPY.BTN_RETRY}
              </button>
            )}
          </div>
        )}

        {view.kind === "done" && view.result.items.length === 0 && <p className="empty">{COPY.EMPTY_RESULTS}</p>}

        {view.kind === "done" && view.result.items.length > 0 && (
          <Results result={view.result} sort={sort} setSort={setSort} grouped={grouped} setGrouped={setGrouped} />
        )}
      </div>
    </>
  );
}

function Status({ result }: { result: ScoutResult }) {
  const time = formatDateTime(result.dataAsOf);
  const badge =
    result.source === "live"
      ? COPY.STATUS_LIVE
      : result.source === "cached"
        ? `Recent result, updated ${minutesAgo(result.dataAsOf, new Date())} min ago`
        : result.source === "saved"
          ? `Saved result from ${time}`
          : `Snapshot from ${time}`;
  const fallbackBanner = (result.source === "saved" || result.source === "snapshot") && result.notes.includes("live_failed");
  return (
    <div className="status">
      <p>
        <span className={`source source-${result.source}`}>{badge}</span>
      </p>
      <p>
        {statusLine({
          time,
          start: formatDate(result.windowStart),
          end: formatDate(result.windowEnd),
          scanned: result.scanned,
          inCategories: result.inCategories,
          shown: result.shown,
        })}
      </p>
      {fallbackBanner && <p className="banner">{bannerSaved(time)}</p>}
      {result.notes.includes("refresh_in_progress") && <p className="banner">{COPY.NOTE_REFRESH}</p>}
      {result.notes.includes("partial") && <p className="banner">{COPY.NOTE_PARTIAL}</p>}
      {result.notes.includes("category_topic") && <p className="banner">{COPY.NOTE_CATEGORY_TOPIC}</p>}
    </div>
  );
}

const GROUP_TEXT: Record<"strong" | "partial" | "weak" | "none", { title: string; note: string }> = {
  strong: { title: COPY.FIT_STRONG, note: COPY.GROUP_STRONG_NOTE },
  partial: { title: COPY.FIT_PARTIAL, note: COPY.GROUP_PARTIAL_NOTE },
  weak: { title: COPY.FIT_WEAK, note: COPY.GROUP_WEAK_NOTE },
  none: { title: COPY.GROUP_NONE, note: COPY.GROUP_NONE_NOTE },
};

function Results(props: {
  result: ScoutResult;
  sort: SortMode;
  setSort: (s: SortMode) => void;
  grouped: boolean;
  setGrouped: (g: boolean) => void;
}) {
  const { result, sort, setSort, grouped, setGrouped } = props;
  const rows = sortRows(result.items, sort);
  const c = summaryCounts(result.items);
  const list = (items: ResultItem[]) => (
    <ol className="rows">
      {items.map((item) => (
        <Row key={item.id} item={item} weights={result.weights} />
      ))}
    </ol>
  );
  return (
    <>
      <section className="summary" aria-label={COPY.SUMMARY_TITLE}>
        <h2>{COPY.SUMMARY_TITLE}</h2>
        <ul>
          <li className="pill fit-strong">
            <strong>{c.strong}</strong> {COPY.FIT_STRONG.toLowerCase()}
          </li>
          <li className="pill fit-partial">
            <strong>{c.partial}</strong> {COPY.FIT_PARTIAL.toLowerCase()}
          </li>
          <li className="pill fit-weak">
            <strong>{c.weak}</strong> {COPY.FIT_WEAK.toLowerCase()}
          </li>
          {c.unrated > 0 && (
            <li className="pill fit-weak">
              <strong>{c.unrated}</strong> not rated
            </li>
          )}
          <li className="pill closing">
            <strong>{c.closing}</strong> closing soon
          </li>
        </ul>
      </section>

      <div className="sortbar">
        <label htmlFor="sort">{COPY.SORT_LABEL}</label>
        <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
          <option value="score">{COPY.SORT_SCORE}</option>
          <option value="closing">{COPY.SORT_CLOSING}</option>
          <option value="newest">{COPY.SORT_NEWEST}</option>
        </select>
        <label className="toggle">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> {COPY.GROUP_LABEL}
        </label>
        <span className="muted note">{COPY.SORT_NOTE}</span>
      </div>

      {!grouped && list(rows)}
      {grouped &&
        groupByFit(rows).map((g) => {
          const key = g.fit ?? "none";
          const text = GROUP_TEXT[key];
          const head = (
            <>
              <span className={`group-title fit-${key}`}>
                {text.title} <span className="count">{g.rows.length}</span>
              </span>
              <span className="muted group-note">{text.note}</span>
            </>
          );
          // Weak fits stay counted but folded away, so the page leads with the contacts worth making.
          return key === "weak" ? (
            <details key={key} className="group">
              <summary className="group-head">{head}</summary>
              {list(g.rows)}
            </details>
          ) : (
            <section key={key} className="group">
              <h2 className="group-head">{head}</h2>
              {list(g.rows)}
            </section>
          );
        })}
      <RunDetails result={result} />
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Some browsers block the modern clipboard; the older copy command still works there.
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      ok = document.execCommand("copy");
      area.remove();
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  return (
    <button type="button" className="copy" onClick={copy} aria-live="polite">
      {copied ? COPY.BTN_COPIED : COPY.BTN_COPY}
    </button>
  );
}

function Row({ item, weights }: { item: ResultItem; weights: { votes: number; maker: number } }) {
  const closing = isClosingSoon(item.daysLeft);
  const parts = breakdownParts(item.score, weights);
  const hidden = item.founder.hiddenCount;
  const fit: FitKey = item.fit;
  const founderTip =
    item.founder.founderSource === "none" ? COPY.FOUNDER_TIP_NONE : hidden > 0 ? `${hidden} of the makers are hidden by Product Hunt.` : undefined;
  return (
    <li className={`row${closing ? " row-closing" : ""}`}>
      <div className="row-head">
        <span className="rank" title="Rank by score">
          #{item.rank}
        </span>
        <h3 className="name">
          <a href={item.productHuntUrl} target="_blank" rel="noopener noreferrer">
            {item.name}
          </a>
        </h3>
        {fit && (
          <span className={`badge fit-${fit}`} title={COPY.FIT_TIP}>
            {FIT_TEXT[fit]}
          </span>
        )}
        {closing && <span className="badge closing">{COPY.BADGE_CLOSING}</span>}
        <span className="score">
          <strong>{oneDecimal(item.score.total)}</strong>
          <span className="muted"> / 100</span>
        </span>
      </div>

      <p className="tagline">{item.tagline.trim() || COPY.NO_DESCRIPTION}</p>

      <p className="meta">
        <span className="founder" title={founderTip}>
          {item.founder.founderSource === "none" ? COPY.FOUNDER_NONE : `Founder: ${item.founder.label}`}
        </span>
        {item.categories.map((c) => (
          <span key={c} className="tag">
            {CATEGORY_CHIP_LABELS[c]}
          </span>
        ))}
        {item.categorySource === "topic" && <span className="tag tag-note">{COPY.CAT_SOURCE_TOPIC}</span>}
      </p>

      <div className="angle">
        <p className="angle-head">
          <strong>{COPY.ANGLE_LABEL}</strong>
          <span className={`badge ${item.angleSource === "gemini" ? "ai" : "template"}`}>
            {item.angleSource === "gemini" ? COPY.BADGE_AI : COPY.BADGE_TEMPLATE}
          </span>
          <CopyButton text={item.angle} />
        </p>
        <p className="angle-text">{item.angle}</p>
      </div>

      <dl className="stats">
        <div title={COPY.METRIC_VOTES_TIP}>
          <dt>{COPY.METRIC_VOTES}</dt>
          <dd>{formatInt(item.upvotes)}</dd>
        </div>
        <div title={COPY.METRIC_MAKER_TIP}>
          <dt>{COPY.METRIC_MAKER}</dt>
          <dd>{formatInt(item.makerComments)}</dd>
        </div>
        <div title={formatDateTime(item.launchedAt)}>
          <dt>Launched</dt>
          <dd>{launchedText(item.daysSinceLaunch).replace("Launched ", "")}</dd>
        </div>
        <div>
          <dt>Outreach window</dt>
          <dd className={closing ? "warn" : undefined}>{closesText(item.daysLeft)}</dd>
        </div>
      </dl>

      <div className="row-foot">
        <span className="links">
          <a href={item.productHuntUrl} target="_blank" rel="noopener noreferrer">
            {COPY.LINK_PH}
          </a>
          {item.websiteUrl && (
            <a href={item.websiteUrl} target="_blank" rel="noopener noreferrer">
              {COPY.LINK_SITE}
            </a>
          )}
        </span>
        <details className="breakdown">
          <summary>{COPY.BREAKDOWN_TITLE}</summary>
          <p>
            Votes part {oneDecimal(parts.votes)}, maker-comments part {oneDecimal(parts.maker)}, weights {Math.round(weights.votes * 100)}/
            {Math.round(weights.maker * 100)}. Scores are relative to this week&apos;s pool, so compare ranks, not scores from different runs.
          </p>
        </details>
      </div>
    </li>
  );
}

function RunDetails({ result }: { result: ScoutResult }) {
  const r = result.run;
  const rows: Array<[string, string]> = [
    ["Pages fetched", r.pages === null ? "none (served from storage)" : String(r.pages)],
    ["Launches scanned", String(result.scanned)],
    ["In your categories", String(result.inCategories)],
    ["Category method", r.categoryMethod === "ai" ? "AI" : r.categoryMethod === "tags" ? "Product Hunt tags" : "Mixed"],
    ["Angle method", r.angleMethod === "ai" ? "AI" : r.angleMethod === "template" ? "Template" : "Mixed"],
    ["Time taken", `${r.seconds} s`],
    ["Product Hunt quota remaining", r.quotaRemaining === null ? "unknown" : formatInt(r.quotaRemaining)],
    ["Result source", result.source],
    ["Model used", r.model],
    ["Storage", r.store === "supabase" ? "Shared (Supabase)" : "Server memory"],
  ];
  return (
    <details className="run-details">
      <summary>{COPY.RUN_TITLE}</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {result.notes.includes("quota_low") && <p>{COPY.RUN_QUOTA}</p>}
      {result.notes.includes("category_topic") && <p>{COPY.RUN_CATEGORY_FALLBACK}</p>}
    </details>
  );
}
