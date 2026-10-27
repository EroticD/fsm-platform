import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("/api/health", () => {
  it("svarer ok uten database- eller diskoppslag", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/health", {
        headers: { "x-request-id": "req-1" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      requestId: "req-1",
    });
  });
});
