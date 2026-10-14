// A "bundle" is one real Product Hunt pool plus what we worked out about it. It is what the cache,
// the saved last real result and the committed snapshot all hold, so every fallback layer feeds the
// same pipeline and looks the same on screen, just labelled with where it came from.
import snapshotFile from "@/data/last-good-snapshot.json";
import type { Classification } from "./classify";
import type { Outreach } from "./outreach";
import type { FitInfo } from "./priority";
import type { Product } from "./types";

/** Bump when the shape changes: bundles with another schema are ignored, never misread. */
export const BUNDLE_SCHEMA = 2;

export type Bundle = {
  schema: typeof BUNDLE_SCHEMA;
  /** When the data was fetched from Product Hunt. Day counts are worked out as of this moment. */
  fetchedAt: string;
  products: Product[];
  pages: number;
  partial: boolean;
  quotaRemaining: number | null;
  /** Category results per product id, so a saved result needs no AI call to show its categories. */
  classifications: Record<string, Classification>;
  /** AI fit ratings per product id (only ratings Gemini really made). */
  fits: Record<string, FitInfo>;
  /** The "Your product" text the saved outreach was written for. */
  productText: string;
  outreach: Record<string, Outreach>;
};

export const isBundle = (b: unknown): b is Bundle => {
  const x = b as Bundle | null;
  return Boolean(x && x.schema === BUNDLE_SCHEMA && typeof x.fetchedAt === "string" && Array.isArray(x.products) && x.products.length > 0);
};

/** The real result committed to the repository after the final warm-up (empty until then). */
export function loadSnapshot(): Bundle | null {
  const b = snapshotFile as unknown as Bundle;
  return isBundle(b) ? b : null;
}
