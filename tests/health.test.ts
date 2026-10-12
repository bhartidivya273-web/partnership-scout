import { afterEach, describe, expect, it } from "vitest";
import { checkKey, GET } from "@/app/api/health/route";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("health route", () => {
  it("reports which settings are present, never their values", async () => {
    process.env.PRODUCT_HUNT_TOKEN = "secret-value-for-test";
    const body = await (await GET(new Request("http://x/api/health"))).json();
    expect(body.settingsPresent.PRODUCT_HUNT_TOKEN).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret-value-for-test");
    expect(body.gemini).toBeUndefined(); // no Gemini test without the key header
  });

  it("does not test Gemini for a request with the wrong key", async () => {
    process.env.PRODUCT_HUNT_TOKEN = "tok";
    const body = await (await GET(new Request("http://x/api/health", { headers: { "x-check-key": "nope" } }))).json();
    expect(body.gemini).toBeUndefined();
  });

  it("with the right key and no Gemini settings, says not_configured", async () => {
    process.env.PRODUCT_HUNT_TOKEN = "tok";
    delete process.env.GEMINI_API_KEY;
    const body = await (await GET(new Request("http://x/api/health", { headers: { "x-check-key": checkKey("tok") } }))).json();
    expect(body.gemini).toBe("not_configured");
  });
});
