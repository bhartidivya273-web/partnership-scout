// Evidence: what we actually know about a launch, and what we do not. Everything here is
// deterministic and comes from Product Hunt's own fields; nothing is guessed or filled in.
import type { Product } from "./types";

export type EvidenceKey = "founder" | "website" | "description" | "makerSignal" | "fit";
export type EvidenceCheck = { key: EvidenceKey; label: string; ok: boolean };
export const EVIDENCE_TOTAL = 5;

const MIN_DESCRIPTION_CHARS = 40;

/** `fitRated` is true only when Gemini actually rated this product (not when a template filled in). */
export function evidenceChecks(p: Product, fitRated: boolean): EvidenceCheck[] {
  return [
    { key: "founder", label: "Maker identified on Product Hunt", ok: p.founder.founderSource === "named" },
    { key: "website", label: "Product website listed", ok: Boolean(p.websiteUrl) },
    { key: "description", label: "Enough description text to ground the outreach", ok: p.description.trim().length >= MIN_DESCRIPTION_CHARS },
    { key: "makerSignal", label: "Maker comments recorded by Product Hunt", ok: p.makerComments > 0 },
    { key: "fit", label: "Fit rated by AI from the product's own text", ok: fitRated },
  ];
}

export const evidenceCount = (checks: EvidenceCheck[]) => checks.filter((c) => c.ok).length;

export type Responsiveness = { level: "high" | "moderate" | "low" | "none"; note: string };

/**
 * A reading of Product Hunt's maker-comment count against the other candidates this week.
 * Absolute floors stop a tiny number from being called "high" in a quiet week.
 * `rank` is 1 for the most maker comments among `total` candidates.
 */
export function responsiveness(makerComments: number, rank: number, total: number): Responsiveness {
  if (makerComments <= 0) {
    return { level: "none", note: "No maker comments recorded by Product Hunt yet, so responsiveness cannot be judged." };
  }
  const topShare = total > 0 ? rank / total : 1;
  if (makerComments >= 10 && topShare <= 0.25) {
    return { level: "high", note: `Makers are very active in their launch thread: ${makerComments} maker comments, #${rank} of ${total} candidates (per Product Hunt).` };
  }
  if (makerComments >= 4 && topShare <= 0.5) {
    return { level: "moderate", note: `Makers are replying: ${makerComments} maker comments, #${rank} of ${total} candidates (per Product Hunt).` };
  }
  return { level: "low", note: `Some maker activity: ${makerComments} maker comment${makerComments === 1 ? "" : "s"}, #${rank} of ${total} candidates (per Product Hunt).` };
}

/** Plain-language list of what is missing or uncertain for one launch. */
export function missingInfo(p: Product, fitRated: boolean): string[] {
  const out: string[] = [];
  if (p.founder.founderSource === "none") {
    out.push("Founder not listed: Product Hunt hides most makers' identities from outside apps. Check the product page for the team.");
  } else if (p.founder.hiddenCount > 0) {
    out.push(`${p.founder.hiddenCount} of this product's makers are hidden by Product Hunt, so the contact may not be the only founder.`);
  }
  if (!p.websiteUrl) out.push("No product website is listed.");
  if (p.description.trim().length < MIN_DESCRIPTION_CHARS) out.push("The product description is very short, so the outreach rests on limited text.");
  if (p.flags.includes("maker_comments_missing")) out.push("Product Hunt did not return a maker-comment count for this launch.");
  else if (p.makerComments === 0) out.push("No maker comments recorded yet, so founder responsiveness is unknown.");
  if (!fitRated) out.push("Fit could not be rated by AI, so relevance is shown as unknown and the outreach is a template.");
  if (p.founder.visibleMakers.length > 0 && p.founder.visibleMakers.every((m) => !m.twitterUsername && !m.websiteUrl)) {
    out.push("No Twitter or website is visible for the maker; the Product Hunt profile is the only contact path.");
  }
  out.push("Product Hunt provides no email addresses. Reach out through the Product Hunt page or the product website.");
  return out;
}
