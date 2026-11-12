import { afterEach, describe, expect, it, vi } from "vitest";
import { searchAddresses, type AddressHit } from "@/lib/address-search";

/** Realistisk treff fra Geonorge, med alle feltene satt. */
const TREFF_MED_ALT = {
  adressetekst: "Karl Johans gate 1",
  postnummer: "0154",
  poststed: "OSLO",
  kommunenavn: "OSLO",
  kommunenummer: "0301",
  representasjonspunkt: { lat: 59.9127, lon: 10.7476 },
};

/** Treff uten postnummer og uten representasjonspunkt. */
const TREFF_UTEN_POSTNR = {
  adressetekst: "Storgata 44",
  kommunenavn: "TROMSØ",
  kommunenummer: "5401",
};

type FetchInit = RequestInit & { next?: { revalidate?: number } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(implementation: (url: URL, init: FetchInit) => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calledUrl(fetchMock: ReturnType<typeof stubFetch>): URL {
  const url = fetchMock.mock.calls[0]?.[0];
  expect(url).toBeInstanceOf(URL);
  return url as unknown as URL;
}

function calledInit(fetchMock: ReturnType<typeof stubFetch>): FetchInit {
  return (fetchMock.mock.calls[0]?.[1] ?? {}) as FetchInit;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchAddresses", () => {
  it("returnerer tomt resultat uten nettverkskall når søket er for kort", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ adresser: [] }));

    await expect(searchAddresses("  k  ")).resolves.toEqual({
      status: "ok",
      hits: [],
    });
    await expect(searchAddresses("")).resolves.toEqual({ status: "ok", hits: [] });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mapper alle feltene fra Geonorge-treffet", async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({ adresser: [TREFF_MED_ALT] }),
    );

    const result = await searchAddresses("  Karl Johans gate 1  ");

    expect(result).toEqual({
      status: "ok",
      hits: [
        {
          text: "Karl Johans gate 1",
          postalCode: "0154",
          city: "OSLO",
          municipality: "OSLO",
          lat: 59.9127,
          lng: 10.7476,
        },
      ],
    });

    const url = calledUrl(fetchMock);
    expect(url.origin + url.pathname).toBe("https://ws.geonorge.no/adresser/v1/sok");
    expect(url.searchParams.get("adressetekst")).toBe("Karl Johans gate 1");
    expect(url.searchParams.get("treffPerSide")).toBe("8");
    expect(url.searchParams.get("utkoordsys")).toBe("4258");

    const init = calledInit(fetchMock);
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "FSM-platform (https://github.com/EroticD/fsm-platform)",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.next).toEqual({ revalidate: 86_400 });
  });

  it("gir null for manglende postnummer og koordinater, og hopper over treff uten adressetekst", async () => {
    stubFetch(async () =>
      jsonResponse({
        adresser: [
          TREFF_UTEN_POSTNR,
          { postnummer: "0154" },
          {
            adressetekst: "  ",
            postnummer: "0154",
          },
        ],
      }),
    );

    const result = await searchAddresses("Storgata 44");

    expect(result).toEqual({
      status: "ok",
      hits: [
        {
          text: "Storgata 44",
          postalCode: null,
          city: null,
          municipality: "TROMSØ",
          lat: null,
          lng: null,
        },
      ],
    });
  });

  it("dedupliserer treff på samme adressetekst og postnummer", async () => {
    const duplikat = { ...TREFF_MED_ALT, representasjonspunkt: { lat: 59.913, lon: 10.748 } };
    stubFetch(async () =>
      jsonResponse({ adresser: [TREFF_MED_ALT, TREFF_MED_ALT, duplikat, TREFF_UTEN_POSTNR] }),
    );

    const result = await searchAddresses("Karl Johans gate");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.hits).toHaveLength(2);
    expect(result.hits.map((hit) => hit.text)).toEqual([
      "Karl Johans gate 1",
      "Storgata 44",
    ]);
  });

  it("klemmer limit til maks 20 og ber om det samme fra Geonorge", async () => {
    const mange = Array.from({ length: 30 }, (_, index) => ({
      adressetekst: `Testveien ${index + 1}`,
      postnummer: "0154",
    }));
    const fetchMock = stubFetch(async () => jsonResponse({ adresser: mange }));

    const result = await searchAddresses("Testveien", 50);

    expect(calledUrl(fetchMock).searchParams.get("treffPerSide")).toBe("20");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.hits).toHaveLength(20);
    expect(result.hits.at(-1)?.text).toBe("Testveien 20");
  });

  it("bruker standard limit når limit er ugyldig", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ adresser: [] }));

    await searchAddresses("Testveien", Number.NaN);
    expect(calledUrl(fetchMock).searchParams.get("treffPerSide")).toBe("8");

    fetchMock.mockClear();
    await searchAddresses("Testveien", 0);
    expect(calledUrl(fetchMock).searchParams.get("treffPerSide")).toBe("8");
  });

  it("returnerer unavailable når Geonorge svarer med feilstatus", async () => {
    stubFetch(async () => jsonResponse({ error: "boom" }, 500));

    await expect(searchAddresses("Karl Johans gate 1")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returnerer unavailable ved timeout/abort og ugyldig JSON", async () => {
    stubFetch(async () => {
      throw Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      });
    });

    await expect(searchAddresses("Karl Johans gate 1")).resolves.toEqual({
      status: "unavailable",
    });

    stubFetch(async () => new Response("<html>nope</html>", { status: 200 }));

    await expect(searchAddresses("Karl Johans gate 1")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("løfter treff med samme postnummer øverst", async () => {
    // Geonorge sorterer ikke etter relevans; Oslo kan komme sist for
    // «Karl Johans gate 1» selv når postnummeret i skjemaet er 0154.
    stubFetch(async () =>
      jsonResponse({
        adresser: [
          {
            adressetekst: "Karl Johans gate 1",
            postnummer: "1706",
            poststed: "SARPSBORG",
            kommunenavn: "SARPSBORG",
          },
          {
            adressetekst: "Karl Johans gate 1",
            postnummer: "0154",
            poststed: "OSLO",
            kommunenavn: "OSLO",
          },
        ],
      }),
    );

    const result = await searchAddresses("Karl Johans gate 1", 2, {
      postalCode: "0154",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.hits[0]?.postalCode).toBe("0154");
      expect(result.hits[1]?.postalCode).toBe("1706");
    }
  });
});

describe("AddressHit", () => {
  it("har nullbare felt for alt som kan mangle", () => {
    const hit: AddressHit = {
      text: "Storgata 44",
      postalCode: null,
      city: null,
      municipality: null,
      lat: null,
      lng: null,
    };

    expect(hit.text).toBe("Storgata 44");
  });
});
