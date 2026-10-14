// Structured server logs (one JSON object per line) so failures can be found in Vercel's log view.
// Anything that looks like a secret is dropped before printing, and long strings are shortened.
const SECRET_KEY = /key|token|secret|authorization|password|cookie/i;

export function safeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }
  return out;
}

export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ t: new Date().toISOString(), event, ...safeFields(fields) }));
  } catch {
    // logging must never break a request
  }
}
