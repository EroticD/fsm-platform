import { describe, expect, it } from "vitest";
import { attachmentDisposition, noStoreJson } from "./http";

describe("noStoreJson", () => {
  it("setter private no-store og Vary: Cookie", async () => {
    const response = noStoreJson({ contacts: [] });

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    await expect(response.json()).resolves.toEqual({ contacts: [] });
  });

  it("beholder status og andre headere", async () => {
    const response = noStoreJson(
      { error: "For mange" },
      { status: 429, headers: { "Retry-After": "12" } },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});

describe("attachmentDisposition", () => {
  it("tvinger attachment og bevarer filnavnet", () => {
    expect(attachmentDisposition("rapport.pdf")).toBe(
      "attachment; filename=\"rapport.pdf\"; filename*=UTF-8''rapport.pdf",
    );
  });

  it("saniterer anførselstegn, sti og kontrolltegn", () => {
    const value = attachmentDisposition('../../ra"pport\r\n.pdf');

    expect(value).toContain('filename="ra_pport__.pdf"');
    expect(value).not.toContain("\r");
    expect(value).not.toContain("\n");
    expect(value.startsWith("attachment;")).toBe(true);
  });

  it("koder norske tegn i RFC 5987-varianten", () => {
    expect(attachmentDisposition("Årsrapport.pdf")).toContain(
      "filename*=UTF-8''%C3%85rsrapport.pdf",
    );
  });
});
