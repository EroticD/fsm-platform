import { describe, expect, it } from "vitest";
import {
  buildDirectionsUrl,
  buildPhoneUrl,
  detectMapPlatform,
  formatMapAddress,
  isValidCoordinates,
  mapDestination,
} from "./maps-links";

const address = {
  address: "Storgata 1",
  postalCode: "0184",
  city: "Oslo",
};

const coordinates = {
  ...address,
  latitude: 59.9127,
  longitude: 10.7461,
};

describe("detectMapPlatform", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5, "ios"],
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "ios"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5, "android"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, "desktop"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0, "desktop"],
  ] as const)("classifies %s", (userAgent, touchPoints, expected) => {
    expect(detectMapPlatform(userAgent, touchPoints)).toBe(expected);
  });
});

describe("coordinates", () => {
  it("accepts real coordinates and rejects out-of-range values", () => {
    expect(isValidCoordinates(59.9, 10.7)).toBe(true);
    expect(isValidCoordinates(-90, 180)).toBe(true);
    expect(isValidCoordinates(90.1, 10)).toBe(false);
    expect(isValidCoordinates(10, 180.1)).toBe(false);
    expect(isValidCoordinates(Number.NaN, 10)).toBe(false);
    expect(isValidCoordinates(null, 10)).toBe(false);
  });

  it("prefers coordinates over the address", () => {
    expect(mapDestination(coordinates)).toBe("59.9127,10.7461");
  });

  it("falls back to a clean formatted address", () => {
    expect(formatMapAddress({ ...address, city: "  Oslo  " })).toBe(
      "Storgata 1, 0184, Oslo",
    );
    expect(mapDestination({ address: "  " })).toBeNull();
  });
});

describe("buildDirectionsUrl", () => {
  it("builds an Apple Maps link on iOS with encoded coordinates", () => {
    expect(buildDirectionsUrl(coordinates, "ios")).toBe(
      "https://maps.apple.com/?daddr=59.9127%2C10.7461&dirflg=d",
    );
  });

  it("builds a geo link on Android", () => {
    expect(buildDirectionsUrl(coordinates, "android")).toBe(
      "geo:0,0?q=59.9127%2C10.7461",
    );
  });

  it("builds a Google Maps directions link on desktop", () => {
    expect(buildDirectionsUrl(coordinates, "desktop")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=59.9127%2C10.7461",
    );
  });

  it("encodes addresses for all platforms", () => {
    const target = {
      address: "Storgata 1 & 2",
      postalCode: "0184",
      city: "Oslo",
    };
    expect(buildDirectionsUrl(target, "ios")).toContain(
      "daddr=Storgata%201%20%26%202%2C%200184%2C%20Oslo",
    );
    expect(buildDirectionsUrl(target, "android")).toContain(
      "q=Storgata%201%20%26%202%2C%200184%2C%20Oslo",
    );
    expect(buildDirectionsUrl(target, "desktop")).toContain(
      "destination=Storgata%201%20%26%202%2C%200184%2C%20Oslo",
    );
  });

  it("never echoes a URL-like address unencoded", () => {
    const target = { address: "javascript:alert(1)" };
    const url = buildDirectionsUrl(target, "desktop");
    expect(url).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=javascript%3Aalert(1)",
    );
    expect(url).not.toContain("destination=javascript:");
  });

  it("returns null when no destination exists", () => {
    expect(buildDirectionsUrl({})).toBeNull();
    expect(buildDirectionsUrl({ address: "   " }, "ios")).toBeNull();
    expect(
      buildDirectionsUrl({ latitude: 200, longitude: 10, address: "Oslo" }),
    ).toContain("destination=Oslo");
  });
});

describe("buildPhoneUrl", () => {
  it("keeps a leading plus and strips formatting", () => {
    expect(buildPhoneUrl("+47 70 00 00 00")).toBe("tel:+4770000000");
    expect(buildPhoneUrl("(070) 00-00-00")).toBe("tel:070000000");
  });

  it("rejects empty and non-phone values", () => {
    expect(buildPhoneUrl("")).toBeNull();
    expect(buildPhoneUrl("javascript:alert(1)")).toBeNull();
    expect(buildPhoneUrl("12")).toBeNull();
    expect(buildPhoneUrl("++4712345678")).toBeNull();
  });
});
