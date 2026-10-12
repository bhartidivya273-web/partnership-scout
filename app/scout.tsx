"use client";

// The one interactive part of the page: controls, honest progress, status line and ranked rows.
import { useEffect, useState } from "react";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/categories";
import { bannerSaved, CATEGORY_CHIP_LABELS, COPY, statusLine } from "@/lib/copy";
import {
  breakdownParts,
  closesText,
  createLineParser,
  formatDate,
  formatDateTime,
  formatInt,
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
  const running = view.kind === "loading";

  // One generic timer rather than invented steps: the step text only changes when the server says so.
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const toggle = (k: CategoryKey) => setSelected((cur) => (cur.includes(k) ? cur.filter((c) => c !== k) : [...cur, k]));

  async function run() {
    if (running || selected.length === 0) return;
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
          <textarea id="product" rows={2} maxLength={300} value={productText} onChange={(e) => setProductText(e.target.value)} disabled={running} />
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
          <>
            <div className="sortbar">
              <label htmlFor="sort">{COPY.SORT_LABEL}</label>
              <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                <option value="score">{COPY.SORT_SCORE}</option>
                <option value="closing">{COPY.SORT_CLOSING}</option>
                <option value="newest">{COPY.SORT_NEWEST}</option>
              </select>
              <span className="muted">{COPY.SORT_NOTE}</span>
            </div>
            <ol className="rows">
              {sortRows(view.result.items, sort).map((item) => (
                <Row key={item.id} item={item} weights={view.result.weights} />
              ))}
            </ol>
            <RunDetails result={view.result} />
          </>
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

function Row({ item, weights }: { item: ResultItem; weights: { votes: number; maker: number } }) {
  const closing = isClosingSoon(item.daysLeft);
  const parts = breakdownParts(item.score, weights);
  const hidden = item.founder.hiddenCount;
  const founderTip =
    item.founder.founderSource === "none" ? COPY.FOUNDER_TIP_NONE : hidden > 0 ? `${hidden} of the makers are hidden by Product Hunt.` : undefined;
  return (
    <li className={`row${closing ? " row-closing" : ""}`}>
      <div className="row-head">
        <span className="rank">#{item.rank}</span>
        <h3 className="name">
          <a href={item.productHuntUrl} target="_blank" rel="noopener noreferrer">
            {item.name}
          </a>
        </h3>
        {item.fit && (
          <span className={`badge fit-${item.fit}`} title={COPY.FIT_TIP}>
            {FIT_TEXT[item.fit]}
          </span>
        )}
        <span className="score">
          Score <strong>{oneDecimal(item.score.total)}</strong> / 100
        </span>
      </div>

      <p className="founder" title={founderTip}>
        {item.founder.founderSource === "none" ? COPY.FOUNDER_NONE : `Founder: ${item.founder.label}`}
      </p>

      <div className="tags">
        {item.categories.map((c) => (
          <span key={c} className="tag">
            {CATEGORY_CHIP_LABELS[c]}
          </span>
        ))}
        {item.categorySource === "topic" && <span className="tag tag-note">{COPY.CAT_SOURCE_TOPIC}</span>}
      </div>

      <p className="tagline">{item.tagline.trim() || COPY.NO_DESCRIPTION}</p>

      <dl className="metrics">
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
          <dd>
            {closesText(item.daysLeft)}
            {closing && <span className="badge closing">{COPY.BADGE_CLOSING}</span>}
          </dd>
        </div>
      </dl>

      <p className="links">
        <a href={item.productHuntUrl} target="_blank" rel="noopener noreferrer">
          {COPY.LINK_PH}
        </a>
        {item.websiteUrl && (
          <a href={item.websiteUrl} target="_blank" rel="noopener noreferrer">
            {COPY.LINK_SITE}
          </a>
        )}
      </p>

      <div className="angle">
        <p className="angle-head">
          <strong>{COPY.ANGLE_LABEL}</strong>
          <span className={`badge ${item.angleSource === "gemini" ? "ai" : "template"}`}>
            {item.angleSource === "gemini" ? COPY.BADGE_AI : COPY.BADGE_TEMPLATE}
          </span>
        </p>
        <p>{item.angle}</p>
      </div>

      <details className="breakdown">
        <summary>{COPY.BREAKDOWN_TITLE}</summary>
        <p>
          Votes part {oneDecimal(parts.votes)}, maker-comments part {oneDecimal(parts.maker)}, weights {Math.round(weights.votes * 100)}/
          {Math.round(weights.maker * 100)}. Scores are relative to this week&apos;s pool, so compare ranks, not scores from different runs.
        </p>
      </details>
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
    ["Storage", r.store === "redis" ? "Shared (Redis)" : "Server memory"],
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
