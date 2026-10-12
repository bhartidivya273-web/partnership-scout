import { describe, expect, it } from "vitest";
import { GeminiError, makeGemini } from "@/lib/gemini";

const KEY = "secret-key-123";
const answer = (text: string, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });
const req = { system: "s", user: "u", schema: {}, attempt: 0 };

describe("Gemini client", () => {
  it("returns no function when the key or model is missing", () => {
    expect(makeGemini({ apiKey: "", model: "m" })).toBeNull();
    expect(makeGemini({ apiKey: KEY, model: "" })).toBeNull();
  });

  it("sends the key in a header, never in the URL, and parses JSON", async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: String(init.body) };
      return answer('[{"id":"1"}]');
    }) as unknown as typeof fetch;
    const gen = makeGemini({ apiKey: KEY, model: "gemini-test", fetchImpl })!;
    expect(await gen(req)).toEqual([{ id: "1" }]);
    expect(seen!.url).toContain("/models/gemini-test:generateContent");
    expect(seen!.url).not.toContain(KEY);
    expect(seen!.headers["x-goog-api-key"]).toBe(KEY);
    expect(JSON.parse(seen!.body).generationConfig.responseMimeType).toBe("application/json");
  });

  it("uses the fallback model on the retry attempt", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => (urls.push(url), answer("[]"))) as unknown as typeof fetch;
    const gen = makeGemini({ apiKey: KEY, model: "main", fallbackModel: "backup", fetchImpl })!;
    await gen({ ...req, attempt: 0 });
    await gen({ ...req, attempt: 1 });
    expect(urls[0]).toContain("/main:");
    expect(urls[1]).toContain("/backup:");
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const fetchImpl = (async () => answer('```json\n[1,2]\n```')) as unknown as typeof fetch;
    expect(await makeGemini({ apiKey: KEY, model: "m", fetchImpl })!(req)).toEqual([1, 2]);
  });

  it("retries without the thinking setting if the model rejects it", async () => {
    let calls = 0;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls += 1;
      const cfg = JSON.parse(String(init.body)).generationConfig;
      return cfg.thinkingConfig ? new Response('{"error":{"message":"Thinking level not supported"}}', { status: 400 }) : answer("[]");
    }) as unknown as typeof fetch;
    expect(await makeGemini({ apiKey: KEY, model: "m", fetchImpl })!(req)).toEqual([]);
    expect(calls).toBe(2);
  });

  it.each([
    [429, "rate_limit"],
    [401, "auth"],
    [403, "auth"],
    [404, "model"],
    [500, "other"],
  ])("maps HTTP %i to %s without leaking the key", async (status, kind) => {
    const fetchImpl = (async () => new Response(`key ${KEY} bad`, { status })) as unknown as typeof fetch;
    const err = (await makeGemini({ apiKey: KEY, model: "m", fetchImpl })!(req).catch((e) => e)) as GeminiError;
    expect(err).toBeInstanceOf(GeminiError);
    expect(err.kind).toBe(kind);
    expect(err.message).not.toContain(KEY);
  });

  it("a 400 saying the key is not valid is reported as an auth problem", async () => {
    const fetchImpl = (async () => new Response('{"error":{"status":"INVALID_ARGUMENT","message":"API key not valid. Please pass a valid API key.","details":[{"reason":"API_KEY_INVALID"}]}}', { status: 400 })) as unknown as typeof fetch;
    const err = (await makeGemini({ apiKey: KEY, model: "m", fetchImpl })!(req).catch((e) => e)) as GeminiError;
    expect(err.kind).toBe("auth");
  });

  it("reports invalid JSON as a format error", async () => {
    const fetchImpl = (async () => answer("not json")) as unknown as typeof fetch;
    const err = (await makeGemini({ apiKey: KEY, model: "m", fetchImpl })!(req).catch((e) => e)) as GeminiError;
    expect(err.kind).toBe("format");
  });

  it("a network failure is reported without details", async () => {
    const fetchImpl = (async () => {
      throw new Error(`connect failed for ${KEY}`);
    }) as unknown as typeof fetch;
    const err = (await makeGemini({ apiKey: KEY, model: "m", fetchImpl })!(req).catch((e) => e)) as GeminiError;
    expect(err.kind).toBe("other");
    expect(err.message).not.toContain(KEY);
  });
});
