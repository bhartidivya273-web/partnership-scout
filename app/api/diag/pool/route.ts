// Temporary Stage S2 proof: runs one real pool fetch and prints COUNTS ONLY (no keys, no post text),
// so the same code can be proven from both the laptop and Vercel. It costs about 1,300 of the shared
// Product Hunt points, so it needs a header key derived from the token (no extra secret to manage).
// To be removed or locked down once the shared cache exists (Stage S5 / S8).
import { createHash } from "node:crypto";
import { fetchFeaturedPosts, ProductHuntError } from "@/lib/producthunt";
import { buildPool } from "@/lib/pool";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function diagKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export async function GET(request: Request) {
  const token = process.env.PRODUCT_HUNT_TOKEN ?? "";
  if (!token || request.headers.get("x-diag-key") !== diagKey(token)) {
    return Response.json({ ok: false, error: "Not allowed." }, { status: 401 });
  }
  const started = Date.now();
  const now = new Date();
  try {
    const r = await fetchFeaturedPosts({ token, now });
    const pool = buildPool(r.posts, now);
    return Response.json({
      ok: true,
      pages: r.pages,
      partial: r.partial,
      postsFetched: r.posts.length,
      inWindow: pool.length,
      withNamedFounder: pool.filter((p) => p.founder.founderSource === "named").length,
      makerCommentsMissing: pool.filter((p) => p.flags.includes("maker_comments_missing")).length,
      quotaRemaining: r.quotaRemaining,
      quotaResetSeconds: r.quotaResetSeconds,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    });
  } catch (err) {
    const kind = err instanceof ProductHuntError ? err.kind : "unavailable";
    return Response.json({ ok: false, error: kind }, { status: kind === "token" ? 500 : 502 });
  }
}
