import type { Founder } from "./founder";

/** One launch, ready for scoring and display (PRD Section 5). */
export type Product = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  productHuntUrl: string;
  websiteUrl: string | null;
  launchedAt: string;
  daysSinceLaunch: number;
  daysLeft: number;
  /** Product Hunt's weighted vote score (`votesCount`), not a raw tally. */
  upvotes: number;
  /** Context only. Never used as the maker-comment count. */
  totalComments: number;
  /** Product Hunt's `makerReplies`: comments written by the makers. */
  makerComments: number;
  founder: Founder;
  topics: string[];
  flags: Array<"maker_comments_missing" | "founder_hidden">;
};
