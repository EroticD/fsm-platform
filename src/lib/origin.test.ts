import { afterEach, describe, expect, it } from "vitest";
import { assertSameOrigin } from "./origin";

const originalAppUrl = process.env.APP_URL;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;

afterEach(() => {
  process.env.APP_URL = originalAppUrl;
  process.env.NEXTAUTH_URL = originalNextAuthUrl;
});

function request(origin?: string, authorization?: string) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost:3000/api/test", { method: "POST", headers });
}

describe("assertSameOrigin", () => {
  it("godtar samme origin som request-URL-en", () => {
    expect(assertSameOrigin(request("http://localhost:3000"))).toBe(true);
  });

  it("godtar APP_URL og NEXTAUTH_URL", () => {
    process.env.APP_URL = "https://fisema.example";
    expect(assertSameOrigin(request("https://fisema.example"))).toBe(true);
  });

  it("avviser en annen origin", () => {
    expect(assertSameOrigin(request("https://evil.example"))).toBe(false);
  });

  it("avviser manglende origin uten bearer-token", () => {
    expect(assertSameOrigin(request())).toBe(false);
  });

  it("godtar manglende origin med bearer-token (cron)", () => {
    expect(assertSameOrigin(request(undefined, "Bearer hemmelig"))).toBe(true);
  });
});
