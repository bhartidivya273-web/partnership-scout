"use client";

import { useState } from "react";
import { COPY } from "@/lib/copy";
import type { Fit } from "@/lib/validate";

export const FIT_TEXT: Record<Fit, string> = { strong: COPY.FIT_STRONG, partial: COPY.FIT_PARTIAL, weak: COPY.FIT_WEAK };

export function FitBadge({ fit }: { fit: Fit | null }) {
  if (!fit) return <span className="badge fit-none" title="The AI could not rate this product">Fit not rated</span>;
  return (
    <span className={`badge fit-${fit}`} title={COPY.FIT_TIP}>
      {FIT_TEXT[fit]}
    </span>
  );
}

/** Copies text, with an older fallback for browsers that block the modern clipboard. */
export function CopyButton({ text, label = COPY.BTN_COPY }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
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
      {copied ? COPY.BTN_COPIED : label}
    </button>
  );
}
