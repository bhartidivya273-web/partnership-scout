import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/diag/pool/route";

describe("diagnostic route guard", () => {
  it("refuses a request without the right key, before any Product Hunt call", async () => {
    process.env.PRODUCT_HUNT_TOKEN = "test-token";
    const res = await GET(new Request("http://x/api/diag/pool", { headers: { "x-diag-key": "wrong" } }));
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("test-token");
  });
  it("refuses everything when no token is configured", async () => {
    delete process.env.PRODUCT_HUNT_TOKEN;
    const res = await GET(new Request("http://x/api/diag/pool"));
    expect(res.status).toBe(401);
  });
});
