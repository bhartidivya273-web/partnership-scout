import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health route", () => {
  it("reports which settings are present, never their values", async () => {
    process.env.PRODUCT_HUNT_TOKEN = "secret-value-for-test";
    const body = await GET().json();
    expect(body.ok).toBe(true);
    expect(body.settingsPresent.PRODUCT_HUNT_TOKEN).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret-value-for-test");
  });
});
