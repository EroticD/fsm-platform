import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addressHash,
  effectiveAddress,
  geocodeAddressDetailed,
} from "./geocode";

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetEnv();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function enableNetwork() {
  process.env.GEOCODE_ENABLED = "true";
  process.env.GEOCODE_TEST_NETWORK = "1";
  process.env.GEOCODE_TIMEOUT_MS = "2000";
}

describe("geocode-adresse", () => {
  it("lar oppdragets adresse overstyre kundens adresse", () => {
    expect(
      effectiveAddress({
        address: "Storgata 1",
        postalCode: "6003",
        city: "Ålesund",
        customer: {
          address: "Kundegata 2",
          postalCode: "5003",
          city: "Bergen",
        },
      }),
    ).toMatchObject({
      address: "Storgata 1",
      postalCode: "6003",
      city: "Ålesund",
      query: "Storgata 1, 6003, Ålesund",
    });
  });

  it("faller tilbake til kundens adresse", () => {
    expect(
      effectiveAddress({
        customer: {
          address: "Kundegata 2",
          postalCode: "5003",
          city: "Bergen",
        },
      }).query,
    ).toBe("Kundegata 2, 5003, Bergen");
  });

  it("gir samme hash for normaliserte varianter", () => {
    expect(addressHash("Storgata 1, 6003, Ålesund")).toBe(
      addressHash("storgata 1 6003 alesund"),
    );
    expect(addressHash("")).toBeNull();
  });
});

describe("geocodeAddressDetailed", () => {
  it("bruker Nominatim når den svarer", async () => {
    enableNetwork();
    const fetchMock = vi.fn(async () =>
      json([{ lat: "59.91", lon: "10.75" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      geocodeAddressDetailed("Karl Johans gate 1, 0154, Oslo"),
    ).resolves.toMatchObject({
      status: "ok",
      provider: "nominatim",
      coordinates: { lat: 59.91, lng: 10.75 },
    });
  });

  it("faller tilbake til Kartverket når Nominatim avviser", async () => {
    enableNetwork();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("nominatim")) return json({}, 403);
        if (url.includes("geonorge")) {
          return json({
            adresser: [
              {
                representasjonspunkt: { lat: 59.911377, lon: 10.749404 },
              },
            ],
          });
        }
        return json({ features: [] });
      }),
    );

    await expect(
      geocodeAddressDetailed("Karl Johans gate 1, 0154, Oslo", {
        address: "Karl Johans gate 1",
        postalCode: "0154",
        city: "Oslo",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      provider: "kartverket",
      coordinates: { lat: 59.911377, lng: 10.749404 },
    });
  });

  it("faller tilbake til Photon når de norske kildene ikke gir treff", async () => {
    enableNetwork();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("nominatim")) return json([]);
        if (url.includes("geonorge")) return json({ adresser: [] });
        return json({
          features: [{ geometry: { coordinates: [10.75, 59.91] } }],
        });
      }),
    );

    await expect(
      geocodeAddressDetailed("Ukjent gate 1, 0154, Oslo", {
        address: "Ukjent gate 1",
        postalCode: "0154",
        city: "Oslo",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      provider: "photon",
      coordinates: { lat: 59.91, lng: 10.75 },
    });
  });

  it("returnerer no_result når alle kilder svarer uten treff", async () => {
    enableNetwork();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("nominatim")) return json([]);
        if (url.includes("geonorge")) return json({ adresser: [] });
        return json({ features: [] });
      }),
    );

    await expect(
      geocodeAddressDetailed("Ukjent gate 1, 0154, Oslo", {
        address: "Ukjent gate 1",
        postalCode: "0154",
        city: "Oslo",
      }),
    ).resolves.toMatchObject({ status: "no_result", coordinates: null });
  });

  it("rapporterer timeout når alle kilder bruker for lang tid", async () => {
    enableNetwork();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("timeout");
        error.name = "TimeoutError";
        throw error;
      }),
    );

    await expect(
      geocodeAddressDetailed("Storgata 1, 0184, Oslo"),
    ).resolves.toMatchObject({ status: "timeout", coordinates: null });
  });

  it("er av som standard i test uten eksplisitt nettverkstillatelse", async () => {
    process.env.GEOCODE_ENABLED = "true";
    delete process.env.GEOCODE_TEST_NETWORK;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      geocodeAddressDetailed("Storgata 1, 0184, Oslo"),
    ).resolves.toMatchObject({ status: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
