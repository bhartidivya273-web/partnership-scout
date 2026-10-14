"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_CHIP_LABELS, COPY } from "@/lib/copy";
import type { Decision, DecisionStatus } from "@/lib/decisions";
import { closesText, formatDateTime, formatInt, launchedText, oneDecimal } from "@/lib/format";
import { PRIORITY_KEYS, PRIORITY_LABELS } from "@/lib/priority";
import type { ResultItem, ScoutResult } from "@/lib/result";
import { CopyButton, FitBadge } from "./bits";
import { ExternalLinks, FounderLine, MakerLinks } from "./Row";

const WHY_SIGNAL: Record<string, string> = {
  votes: "Product Hunt's weighted vote score, log-scaled against the best candidate this week (assignment signal).",
  maker: "Comments written by the makers, as counted by Product Hunt, log-scaled against the most active candidate (assignment signal).",
  momentum: "Votes per day since launch, log-scaled: the same votes earned faster count for more, so older launches are not favoured only for being older.",
  relevance: "The AI's fit rating for your product: strong 100%, partial 60%, weak 20%, not rated 40% (neutral).",
  window: "Days left in the 7-day outreach window out of 7.",
  evidence: "How many of the 5 evidence checks below are met.",
};

export type SaveInfo = { saved: "server" | "browser"; storage: "supabase" | "memory" | "browser"; error: string | null };

export function Detail(props: {
  item: ResultItem;
  result: ScoutResult;
  decision?: Decision;
  saveInfo: SaveInfo;
  candidates: number;
  onClose: () => void;
  onUpdate: (item: ResultItem, patch: { status?: DecisionStatus; note?: string }) => void;
}) {
  const { item, result, decision, saveInfo, candidates, onClose, onUpdate } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState(decision?.note ?? "");
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const status = decision?.status ?? "none";
  const noteChanged = note.trim() !== (decision?.note ?? "");
  const o = item.outreach;

  return (
    <dialog
      ref={ref}
      className="detail"
      aria-labelledby="detail-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close(); // a click on the backdrop closes it
      }}
    >
      <div className="detail-inner">
        <header className="detail-head">
          <div>
            <p className="muted small-text">
              Rank #{item.rank} of {candidates} candidates
            </p>
            <h2 id="detail-title">
              <a href={item.productHuntUrl} target="_blank" rel="noopener noreferrer">
                {item.name}
              </a>
            </h2>
            <p className="tagline">{item.tagline.trim() || COPY.NO_DESCRIPTION}</p>
            <p className="meta">
              <FitBadge fit={item.fit} />
              {item.categories.map((c) => (
                <span key={c} className="tag">
                  {CATEGORY_CHIP_LABELS[c]}
                </span>
              ))}
            </p>
          </div>
          <div className="detail-score">
            <strong>{oneDecimal(item.priority.total)}</strong>
            <span className="muted"> / 100</span>
            <button type="button" className="secondary small" onClick={() => ref.current?.close()} autoFocus>
              Close
            </button>
          </div>
        </header>

        <section aria-labelledby="d-decision">
          <h3 id="d-decision">Your decision</h3>
          <div className="decision-buttons" role="group" aria-label="Status">
            {(["none", "shortlisted", "contacted"] as DecisionStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`secondary small${status === s ? " on" : ""}`}
                aria-pressed={status === s}
                onClick={() => onUpdate(item, { status: s })}
              >
                {s === "none" ? "Not reviewed" : s === "shortlisted" ? "★ Shortlisted" : "✓ Contacted"}
              </button>
            ))}
          </div>
          <label htmlFor="note" className="label">
            Private note
          </label>
          <textarea id="note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: found the founder on X, follow up on Friday." />
          <div className="actions">
            <button type="button" className="primary small" disabled={!noteChanged} onClick={() => onUpdate(item, { note: note.trim() })}>
              Save note
            </button>
            <span className="muted small-text" role="status">
              {saveInfo.error
                ? saveInfo.error
                : decision
                  ? saveInfo.saved === "server" && saveInfo.storage === "memory"
                    ? "Saved on the server for now (the database is not connected, so it may not last)."
                    : saveInfo.saved === "server"
                      ? "Saved."
                      : "Saved in this browser only."
                  : "Nothing saved yet."}
            </span>
          </div>
        </section>

        <section aria-labelledby="d-partner">
          <h3 id="d-partner">Partnership idea</h3>
          <p className="muted small-text">
            <span className={`badge ${o.source === "gemini" ? "ai" : "template"}`}>{o.source === "gemini" ? COPY.BADGE_AI : COPY.BADGE_TEMPLATE}</span> You review and edit
            everything before sending. Nothing is sent for you.
          </p>
          <dl className="idea">
            <dt>The connection</dt>
            <dd>{o.connection}</dd>
            <dt>The partnership hypothesis</dt>
            <dd>{o.hypothesis}</dd>
            <dt>
              Opening message <CopyButton text={o.message} label="Copy message" />
            </dt>
            <dd className="message">{o.message}</dd>
            <dt>
              The question <CopyButton text={o.question} label="Copy question" />
            </dt>
            <dd>{o.question}</dd>
            <dt>Check before sending</dt>
            <dd className="caveat">{o.caveat}</dd>
          </dl>
        </section>

        <section aria-labelledby="d-why">
          <h3 id="d-why">Why it is ranked here</h3>
          <ul className="plain">
            {item.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
            <li>{item.responsiveness.note}</li>
          </ul>
          <table className="breakdown-table">
            <caption className="muted small-text">Score breakdown (priority {oneDecimal(item.priority.total)} out of 100)</caption>
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col">Value</th>
                <th scope="col">Weight</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {PRIORITY_KEYS.map((k) => {
                const part = item.priority.parts[k];
                return (
                  <tr key={k} title={WHY_SIGNAL[k]}>
                    <th scope="row">{PRIORITY_LABELS[k]}</th>
                    <td>{Math.round(part.value * 100)}%</td>
                    <td>{oneDecimal(part.weight)}</td>
                    <td>{oneDecimal(part.points)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small-text">
            Assignment score (votes and maker comments only, 50/50): <strong>{oneDecimal(item.core.total)}</strong> out of 100. Scores are relative to this week&apos;s candidate pool, so compare
            ranks, not scores from different runs. Weights: {result.preset === "custom" ? "custom" : result.preset} preset.
          </p>
        </section>

        <section aria-labelledby="d-evidence">
          <h3 id="d-evidence">Evidence ({item.evidence.count} of {item.evidence.total})</h3>
          <ul className="checks">
            {item.evidence.checks.map((c) => (
              <li key={c.key} className={c.ok ? "ok" : "no"}>
                <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> <span className="sr-only">{c.ok ? "Met: " : "Not met: "}</span>
                {c.label}
              </li>
            ))}
          </ul>
          <h3>Missing or uncertain</h3>
          <ul className="plain">
            {item.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="d-founder">
          <h3 id="d-founder">Founder and contact path</h3>
          <p>
            <FounderLine item={item} full />
          </p>
          {item.founder.makers.map((m, i) => (
            <p key={i} className="muted small-text">
              {m.name}
              {m.headline ? `: ${m.headline}` : ""}
            </p>
          ))}
          <p>
            <MakerLinks item={item} />
          </p>
          <p>
            <ExternalLinks item={item} />
          </p>
        </section>

        <section aria-labelledby="d-source">
          <h3 id="d-source">Source</h3>
          <ul className="plain">
            <li>
              {COPY.METRIC_VOTES}: {formatInt(item.upvotes)}. {COPY.METRIC_MAKER}: {formatInt(item.makerComments)}.
            </li>
            <li>
              {launchedText(item.daysSinceLaunch)} ({formatDateTime(item.launchedAt)}); {closesText(item.daysLeft).toLowerCase()}.
            </li>
            <li>
              Product Hunt API data fetched {formatDateTime(result.dataAsOf)} ({result.source === "live" ? "live" : result.source}). Votes are Product Hunt&apos;s weighted score; maker comments are
              Product Hunt&apos;s own count and can differ from a hand count by a few on busy threads.
            </li>
          </ul>
        </section>
      </div>
    </dialog>
  );
}
