"use client";

import { CATEGORY_KEYS, type CategoryKey } from "@/lib/categories";
import { CATEGORY_CHIP_LABELS, COPY } from "@/lib/copy";
import type { PresetName } from "@/lib/priority";

const PRESET_TEXT: Record<PresetName, { label: string; help: string }> = {
  balanced: { label: "Balanced", help: "Votes, maker comments, fit, momentum, time left and evidence all count." },
  engagement: { label: "Engagement first", help: "Votes and maker comments count most; fit counts little." },
  fit: { label: "Fit first", help: "Relevance to async standups counts most; popularity counts less." },
};

export function Controls(props: {
  selected: CategoryKey[];
  onToggle: (k: CategoryKey) => void;
  productText: string;
  onProductText: (v: string) => void;
  preset: PresetName;
  onPreset: (p: PresetName) => void;
  running: boolean;
  onRun: () => void;
  onRefresh: () => void;
  canRefresh: boolean;
  refreshHint: string;
  windowText: string;
  updatedText: string | null;
}) {
  const { selected, running } = props;
  const none = selected.length === 0;
  return (
    <section className="panel" aria-label="Search controls">
      <fieldset className="field">
        <legend className="label">{COPY.CAT_LABEL}</legend>
        <div className="chips">
          {CATEGORY_KEYS.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={selected.includes(k)} onClick={() => props.onToggle(k)} disabled={running}>
              {CATEGORY_CHIP_LABELS[k]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="product">
          {COPY.PRODUCT_LABEL}
        </label>
        <textarea id="product" rows={1} maxLength={300} value={props.productText} onChange={(e) => props.onProductText(e.target.value)} disabled={running} />
        <p className="help">{COPY.PRODUCT_HELP}</p>
      </div>

      <div className="field inline">
        <label className="label" htmlFor="preset">
          Ranking priorities
        </label>
        <select id="preset" value={props.preset} onChange={(e) => props.onPreset(e.target.value as PresetName)} disabled={running}>
          {(Object.keys(PRESET_TEXT) as PresetName[]).map((p) => (
            <option key={p} value={p}>
              {PRESET_TEXT[p].label}
            </option>
          ))}
        </select>
        <span className="help">{PRESET_TEXT[props.preset].help}</span>
      </div>

      <p className="window" aria-label="Launch window">
        <strong>Launch window:</strong> {props.windowText}
        {props.updatedText ? <span className="muted"> · {props.updatedText}</span> : null}
      </p>

      <div className="actions">
        <button type="button" className="primary" onClick={props.onRun} disabled={running || none}>
          {running ? COPY.BTN_RUNNING : COPY.BTN_RUN}
        </button>
        <button type="button" className="secondary" onClick={props.onRefresh} disabled={running || none || !props.canRefresh} title={props.refreshHint || COPY.REFRESH_TIP}>
          {COPY.BTN_REFRESH}
        </button>
        {props.refreshHint && !running && <span className="muted small-text">{props.refreshHint}</span>}
        {none && <span className="hint">{COPY.HINT_CATEGORY}</span>}
      </div>
    </section>
  );
}
