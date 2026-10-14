"use client";

import { CATEGORY_CHIP_LABELS, COPY } from "@/lib/copy";
import type { Decision } from "@/lib/decisions";
import { formatInt } from "@/lib/format";
import type { ResultItem, ScoutResult } from "@/lib/result";
import {
  filterItems,
  groupByFit,
  hasActiveFilters,
  NO_FILTERS,
  SORT_LABELS,
  sortItems,
  summaryCounts,
  type AgeFilter,
  type EvidenceFilter,
  type Filters,
  type SortMode,
  type StatusFilter,
} from "@/lib/workspace";
import { FIT_TEXT } from "./bits";
import { Row } from "./Row";

const GROUP_TEXT = {
  strong: { title: COPY.FIT_STRONG, note: COPY.GROUP_STRONG_NOTE },
  partial: { title: COPY.FIT_PARTIAL, note: COPY.GROUP_PARTIAL_NOTE },
  weak: { title: COPY.FIT_WEAK, note: COPY.GROUP_WEAK_NOTE },
  none: { title: COPY.GROUP_NONE, note: COPY.GROUP_NONE_NOTE },
} as const;

export function Results(props: {
  result: ScoutResult;
  decisions: Record<string, Decision>;
  sort: SortMode;
  setSort: (s: SortMode) => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  grouped: boolean;
  setGrouped: (g: boolean) => void;
  onOpen: (id: string) => void;
  onToggleShortlist: (item: ResultItem) => void;
}) {
  const { result, decisions, sort, filters, grouped } = props;
  const counts = summaryCounts(result.items, decisions);
  const visible = sortItems(filterItems(result.items, filters, decisions), sort);
  const set = (patch: Partial<Filters>) => props.setFilters({ ...filters, ...patch });
  const list = (items: ResultItem[]) => (
    <ol className="rows">
      {items.map((item) => (
        <Row key={item.id} item={item} decision={decisions[item.id]} onOpen={props.onOpen} onToggleShortlist={props.onToggleShortlist} />
      ))}
    </ol>
  );

  return (
    <>
      <section className="summary" aria-label={COPY.SUMMARY_TITLE}>
        <h2>{COPY.SUMMARY_TITLE}</h2>
        <ul>
          <li className="pill fit-strong">
            <strong>{counts.strong}</strong> {FIT_TEXT.strong.toLowerCase()}
          </li>
          <li className="pill fit-partial">
            <strong>{counts.partial}</strong> {FIT_TEXT.partial.toLowerCase()}
          </li>
          <li className="pill fit-weak">
            <strong>{counts.weak}</strong> {FIT_TEXT.weak.toLowerCase()}
          </li>
          {counts.unrated > 0 && (
            <li className="pill fit-none">
              <strong>{counts.unrated}</strong> not rated
            </li>
          )}
          <li className="pill closing">
            <strong>{counts.closing}</strong> closing soon
          </li>
          <li className="pill status-shortlisted">
            <strong>{counts.shortlisted}</strong> shortlisted
          </li>
          <li className="pill status-contacted">
            <strong>{counts.contacted}</strong> contacted
          </li>
        </ul>
      </section>

      <section className="toolbar" aria-label="Sort and filter">
        <div className="tool">
          <label htmlFor="sort">{COPY.SORT_LABEL}</label>
          <select id="sort" value={sort} onChange={(e) => props.setSort(e.target.value as SortMode)}>
            {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
              <option key={m} value={m}>
                {SORT_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="tool">
          <label htmlFor="f-cat">Category</label>
          <select id="f-cat" value={filters.category} onChange={(e) => set({ category: e.target.value as Filters["category"] })}>
            <option value="all">All categories</option>
            {result.categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_CHIP_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="tool">
          <label htmlFor="f-age">Launch age</label>
          <select id="f-age" value={filters.age} onChange={(e) => set({ age: e.target.value as AgeFilter })}>
            <option value="any">Any (last 7 days)</option>
            <option value="1">Last 24 hours</option>
            <option value="3">Last 3 days</option>
          </select>
        </div>
        <div className="tool">
          <label htmlFor="f-ev">Minimum evidence</label>
          <select id="f-ev" value={filters.evidence} onChange={(e) => set({ evidence: e.target.value as EvidenceFilter })}>
            <option value="0">Any</option>
            <option value="3">At least 3 of 5 checks</option>
            <option value="5">All 5 checks</option>
          </select>
        </div>
        <div className="tool">
          <label htmlFor="f-st">My decisions</label>
          <select id="f-st" value={filters.status} onChange={(e) => set({ status: e.target.value as StatusFilter })}>
            <option value="all">All</option>
            <option value="new">Not reviewed</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="contacted">Contacted</option>
          </select>
        </div>
        <label className="toggle tool">
          <input type="checkbox" checked={grouped} onChange={(e) => props.setGrouped(e.target.checked)} /> {COPY.GROUP_LABEL}
        </label>
        <p className="muted small-text toolbar-note" role="status">
          Showing {formatInt(visible.length)} of {formatInt(result.items.length)} products. Sorting and filters apply to these rows only and do not fetch new data.
          {hasActiveFilters(filters) && (
            <>
              {" "}
              <button type="button" className="linkish" onClick={() => props.setFilters(NO_FILTERS)}>
                {COPY.BTN_CLEAR_FILTERS}
              </button>
            </>
          )}
        </p>
      </section>

      {visible.length === 0 && (
        <p className="empty">
          {COPY.EMPTY_FILTERED}{" "}
          <button type="button" className="linkish" onClick={() => props.setFilters(NO_FILTERS)}>
            {COPY.BTN_CLEAR_FILTERS}
          </button>
        </p>
      )}
      {visible.length > 0 && !grouped && list(visible)}
      {visible.length > 0 &&
        grouped &&
        groupByFit(visible).map((g) => {
          const key = g.fit ?? "none";
          const text = GROUP_TEXT[key];
          const head = (
            <>
              <span className={`group-title fit-${key}`}>
                {text.title} <span className="count">{g.items.length}</span>
              </span>
              <span className="muted group-note">{text.note}</span>
            </>
          );
          // Weak fits stay counted but folded away, so the page leads with the contacts worth making.
          return key === "weak" ? (
            <details key={key} className="group">
              <summary className="group-head">{head}</summary>
              {list(g.items)}
            </details>
          ) : (
            <section key={key} className="group">
              <h2 className="group-head">{head}</h2>
              {list(g.items)}
            </section>
          );
        })}
    </>
  );
}
