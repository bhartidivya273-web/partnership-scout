// The scout endpoint: one call per click. The answer is a stream of small JSON lines, first the real
// pipeline steps as they begin ("honest progress", PRD A3), then the result or a plain error.
import { COPY } from "@/lib/copy";
import { getDeps } from "@/lib/runtime";
import { runScout, ScoutError, type ScoutInput } from "@/lib/scout";
import type { ScoutEvent } from "@/lib/result";

export const dynamic = "force-dynamic";
// A cold first run takes about 40 seconds; 300 (the Vercel Hobby maximum) covers slow Gemini answers
// plus retries, and the lock expires after 310 so it can never outlive the run.
export const maxDuration = 300;

const MAX_BODY = 4_000;

export async function POST(request: Request) {
  let body: ScoutInput = {};
  try {
    const text = await request.text();
    if (text.length <= MAX_BODY) body = JSON.parse(text);
  } catch {
    body = {};
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ScoutEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        const result = await runScout(body, getDeps(), emit);
        emit({ type: "result", result });
      } catch (err) {
        // Only our own plain messages ever reach the page; unexpected errors are reduced to a generic line.
        const code = err instanceof ScoutError ? err.code : "generic";
        emit({ type: "error", code, message: err instanceof ScoutError ? err.message : COPY.ERR_GENERIC });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
