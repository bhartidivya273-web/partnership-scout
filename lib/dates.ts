// All date rules live here so they can be tested with a fixed clock (never the real one).
const DAY_MS = 24 * 60 * 60 * 1000;
export const WINDOW_DAYS = 7;

/** Product Hunt's `createdAt` is the launch time (identical to `featuredAt` for featured posts). */
function toMs(launch: string | null | undefined): number | null {
  if (!launch) return null;
  const ms = Date.parse(launch);
  return Number.isNaN(ms) ? null : ms;
}

/** Rolling 7 x 24h window, inclusive at both ends. Scheduled (future) and undated posts are out. */
export function inWindow(launch: string | null | undefined, now: Date): boolean {
  const ms = toMs(launch);
  if (ms === null) return false;
  return ms >= now.getTime() - WINDOW_DAYS * DAY_MS && ms <= now.getTime();
}

/** Whole elapsed 24-hour periods since launch; a launch earlier today is 0. */
export function daysSinceLaunch(launch: string, now: Date): number {
  const ms = toMs(launch) ?? now.getTime();
  return Math.max(0, Math.floor((now.getTime() - ms) / DAY_MS));
}

/** Days left in Kavya's outreach window, rounded up, never below 0. */
export function daysLeft(launch: string, now: Date): number {
  const ms = toMs(launch) ?? now.getTime();
  return Math.max(0, Math.ceil((ms + WINDOW_DAYS * DAY_MS - now.getTime()) / DAY_MS));
}

/** Start of the window as an ISO string, sent to Product Hunt as `postedAfter`. */
export function windowStart(now: Date): string {
  return new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString();
}
