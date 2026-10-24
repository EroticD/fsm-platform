import { afterEach, describe, expect, it } from "vitest";
import { assertSameOrigin } from "./origin";

const originalAppUrl = process.env.APP_URL;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;
const originalCronSecret = process.env.CRON_SECRET;
const originalReadySecret = process.env.READY_SECRET;

afterEach(() => {
  process.env.APP_URL = originalAppUrl;
  process.env.NEXTAUTH_URL = originalNextAuthUrl;
  process.env.CRON_SECRET = originalCronSecret;
  process.env.READY_SECRET = originalReadySecret;
});

function request(
  origin?: string,
  authorization?: string,
  secFetchSite?: string,
) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (authorization) headers.set("authorization", authorization);
  if (secFetchSite) headers.set("sec-fetch-site", secFetchSite);
  return new Request("http://localhost:3000/api/test", {
    method: "POST",
    headers,
  });
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

  it("godtar manglende origin fra same-origin nettleser", () => {
    expect(assertSameOrigin(request(undefined, undefined, "same-origin"))).toBe(true);
    expect(assertSameOrigin(request(undefined, undefined, "none"))).toBe(true);
  });

  it("avviser manglende origin uten gyldig bearer", () => {
    expect(assertSameOrigin(request())).toBe(false);
    expect(assertSameOrigin(request(undefined, "Bearer vilkårlig"))).toBe(false);
  });

  it("godtar manglende origin med gyldig CRON_SECRET", () => {
    process.env.CRON_SECRET = "riktig-hemmelighet";
    expect(
      assertSameOrigin(request(undefined, "Bearer riktig-hemmelighet")),
    ).toBe(true);
    expect(
      assertSameOrigin(request(undefined, "Bearer feil-hemmelighet")),
    ).toBe(false);
  });
});
