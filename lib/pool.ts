// Turns raw Product Hunt posts into the candidate pool: only launches inside the 7-day window,
// one row per product id, with founder, maker comments and day counts worked out.
import { daysLeft, daysSinceLaunch, inWindow } from "./dates";
import { resolveFounder, type RawMaker } from "./founder";
import type { RawPost } from "./producthunt";
import type { Product } from "./types";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);

function topicNames(v: unknown): string[] {
  const edges = (v as { edges?: Array<{ node?: { name?: unknown } }> } | null)?.edges ?? [];
  return edges.map((e) => str(e.node?.name)).filter(Boolean);
}

export function buildPool(raw: RawPost[], now: Date): Product[] {
  const seen = new Set<string>();
  const pool: Product[] = [];
  for (const post of raw) {
    const id = String(post.id ?? "");
    const launchedAt = typeof post.createdAt === "string" ? post.createdAt : null;
    if (!id || seen.has(id) || !inWindow(launchedAt, now)) continue;
    seen.add(id);

    const founder = resolveFounder(post.makers as RawMaker[] | null);
    const flags: Product["flags"] = [];
    // The API schema says makerReplies is never null; if it is ever missing, count 0 and say so.
    const makerMissing = typeof post.makerReplies !== "number";
    if (makerMissing) flags.push("maker_comments_missing");
    if (founder.founderSource === "none") flags.push("founder_hidden");

    pool.push({
      id,
      name: str(post.name),
      tagline: str(post.tagline),
      description: str(post.description),
      productHuntUrl: str(post.url),
      websiteUrl: str(post.website) || null,
      launchedAt: launchedAt as string,
      daysSinceLaunch: daysSinceLaunch(launchedAt as string, now),
      daysLeft: daysLeft(launchedAt as string, now),
      upvotes: int(post.votesCount),
      totalComments: int(post.commentsCount),
      makerComments: makerMissing ? 0 : int(post.makerReplies),
      founder,
      topics: topicNames(post.topics),
      flags,
    });
  }
  return pool;
}
