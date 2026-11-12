import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isValidOrgNumber,
  lookupCompany,
  normalizeOrgNumber,
  type CompanyRecord,
} from "@/lib/brreg";

/** Realistisk enhet fra Enhetsregisteret, med alle feltene satt. */
const ENHET_MED_ALT = {
  organisasjonsnummer: "923609016",
  navn: "NORDLYS SERVICE AS",
  organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
  forretningsadresse: {
    land: "Norge",
    landkode: "NO",
    kommune: "TROMSØ",
    kommunenummer: "5401",
    postnummer: "9008",
    poststed: "TROMSØ",
    adresse: ["Storgata 44"],
  },
  postadresse: {
    land: "Norge",
    landkode: "NO",
    postnummer: "9009",
    poststed: "TROMSØ",
    adresse: ["Postboks 123"],
  },
  naeringskode1: {
    kode: "43.210",
    beskrivelse: "Elektrisk installasjonsvirksomhet",
  },
  telefon: "776 00 000",
  hjemmeside: "https://nordlys-service.no",
  registrertIMvaregisteret: true,
  konkurs: false,
  underAvvikling: false,
  antallAnsatte: 12,
};

/** Enhet uten adresse, telefon og nettside – feltene mangler helt. */
const ENHET_UTEN_KONTAKT = {
  organisasjonsnummer: "974760673",
  navn: "ENKELT ENKELTPERSONFORETAK",
  organisasjonsform: { kode: "ENK", beskrivelse: "Enkeltpersonforetak" },
  registrertIMvaregisteret: false,
  konkurs: false,
  underAvvikling: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchArgs = [string, RequestInit & { next?: { revalidate?: number } }];

function stubFetch(implementation: (...args: FetchArgs) => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeOrgNumber", () => {
  it("fjerner mellomrom og punktum", () => {
    expect(normalizeOrgNumber("923 609 016")).toBe("923609016");
    expect(normalizeOrgNumber("923.609.016")).toBe("923609016");
    expect(normalizeOrgNumber(" 923 609 016 ")).toBe("923609016");
  });

  it("fjerner NO-prefiks og MVA-suffiks", () => {
    expect(normalizeOrgNumber("NO923609016")).toBe("923609016");
    expect(normalizeOrgNumber("no 923 609 016")).toBe("923609016");
    expect(normalizeOrgNumber("923609016MVA")).toBe("923609016");
    expect(normalizeOrgNumber("923609016-MVA")).toBe("923609016");
    expect(normalizeOrgNumber("NO 923 609 016 MVA")).toBe("923609016");
  });

  it("avviser for korte og for lange numre", () => {
    expect(normalizeOrgNumber("92360901")).toBeNull();
    expect(normalizeOrgNumber("9236090161")).toBeNull();
    expect(normalizeOrgNumber("")).toBeNull();
  });

  it("avviser ikke-numeriske og ikke-strengede verdier", () => {
    expect(normalizeOrgNumber("92360901A")).toBeNull();
    expect(normalizeOrgNumber(null)).toBeNull();
    expect(normalizeOrgNumber(undefined)).toBeNull();
    expect(normalizeOrgNumber(923609016)).toBeNull();
    expect(normalizeOrgNumber({})).toBeNull();
  });
});

describe("isValidOrgNumber", () => {
  it("godtar kjente gyldige organisasjonsnumre", () => {
    expect(isValidOrgNumber("923609016")).toBe(true);
    expect(isValidOrgNumber("974760673")).toBe(true);
  });

  it("avviser feil kontrollsiffer", () => {
    expect(isValidOrgNumber("123456789")).toBe(false);
  });

  it("avviser feil lengde og ikke-sifre", () => {
    expect(isValidOrgNumber("92360901")).toBe(false);
    expect(isValidOrgNumber("9236090161")).toBe(false);
    expect(isValidOrgNumber("92360 016")).toBe(false);
    expect(isValidOrgNumber("")).toBe(false);
  });
});

describe("lookupCompany", () => {
  it("mapper en full enhet til CompanyRecord", async () => {
    stubFetch(async () => jsonResponse(ENHET_MED_ALT));

    const result = await lookupCompany("NO 923 609 016 MVA");

    expect(result.status).toBe("found");
    const company = (result as { status: "found"; company: CompanyRecord })
      .company;
    expect(company).toEqual({
      orgNumber: "923609016",
      name: "NORDLYS SERVICE AS",
      organisationForm: "Aksjeselskap",
      address: "Storgata 44",
      postalCode: "9008",
      city: "TROMSØ",
      phone: "776 00 000",
      website: "https://nordlys-service.no",
      industryCode: "43.210",
      industryDescription: "Elektrisk installasjonsvirksomhet",
      employees: 12,
      registeredInVat: true,
      bankrupt: false,
      underLiquidation: false,
    });
  });

  it("bruker forretningsadresse fremfor postadresse", async () => {
    stubFetch(async () => jsonResponse(ENHET_MED_ALT));

    const result = await lookupCompany("923609016");

    expect(result).toMatchObject({
      status: "found",
      company: { address: "Storgata 44", postalCode: "9008", city: "TROMSØ" },
    });
  });

  it("faller tilbake til postadresse når forretningsadresse mangler", async () => {
    stubFetch(async () =>
      jsonResponse({
        ...ENHET_MED_ALT,
        forretningsadresse: undefined,
      }),
    );

    const result = await lookupCompany("923609016");

    expect(result).toMatchObject({
      status: "found",
      company: {
        address: "Postboks 123",
        postalCode: "9009",
        city: "TROMSØ",
      },
    });
  });

  it("gir null for manglende felter, aldri undefined", async () => {
    stubFetch(async () => jsonResponse(ENHET_UTEN_KONTAKT));

    const result = await lookupCompany("974760673");

    expect(result.status).toBe("found");
    const company = (result as { status: "found"; company: CompanyRecord })
      .company;
    expect(company).toEqual({
      orgNumber: "974760673",
      name: "ENKELT ENKELTPERSONFORETAK",
      organisationForm: "Enkeltpersonforetak",
      address: null,
      postalCode: null,
      city: null,
      phone: null,
      website: null,
      industryCode: null,
      industryDescription: null,
      employees: null,
      registeredInVat: false,
      bankrupt: false,
      underLiquidation: false,
    });
    for (const value of Object.values(company)) {
      expect(value).not.toBeUndefined();
    }
  });

  it("flater ut flerlinjede adresser og flagger avvikling", async () => {
    stubFetch(async () =>
      jsonResponse({
        ...ENHET_MED_ALT,
        forretningsadresse: {
          postnummer: "0182",
          poststed: "OSLO",
          adresse: ["Karl Johans gate 1", "3. etasje"],
        },
        konkurs: true,
        underTvangsavviklingEllerTvangsopplosning: true,
      }),
    );

    const result = await lookupCompany("923609016");

    expect(result).toMatchObject({
      status: "found",
      company: {
        address: "Karl Johans gate 1, 3. etasje",
        postalCode: "0182",
        city: "OSLO",
        bankrupt: true,
        underLiquidation: true,
      },
    });
  });

  it("kaller riktig endepunkt med JSON, User-Agent og 24 t cache", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(ENHET_MED_ALT));

    await lookupCompany("923 609 016");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://data.brreg.no/enhetsregisteret/api/enheter/923609016",
    );
    expect(init.headers).toMatchObject({ Accept: "application/json" });
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("FSM-platform");
    expect(headers["User-Agent"]).toMatch(/https?:\/\//);
    expect(init.next?.revalidate).toBe(86_400);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returnerer not_found for 404", async () => {
    stubFetch(async () => new Response("", { status: 404 }));

    await expect(lookupCompany("923609016")).resolves.toEqual({
      status: "not_found",
    });
  });

  it("returnerer removed for 410", async () => {
    stubFetch(async () => new Response("", { status: 410 }));

    await expect(lookupCompany("923609016")).resolves.toEqual({
      status: "removed",
    });
  });

  it("returnerer unavailable for 500", async () => {
    stubFetch(async () => new Response("", { status: 500 }));

    await expect(lookupCompany("923609016")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returnerer unavailable når tjenesten ikke svarer (timeout)", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    await expect(lookupCompany("923609016")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returnerer unavailable ved AbortError", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    await expect(lookupCompany("923609016")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returnerer unavailable ved nettverksfeil", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(lookupCompany("923609016")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returnerer unavailable når svaret ikke er gyldig JSON", async () => {
    stubFetch(
      async () =>
        new Response("<html>feil</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );

    await expect(lookupCompany("923609016")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("gjør ingen oppslag når nummeret ikke kan normaliseres", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(ENHET_MED_ALT));

    await expect(lookupCompany("123")).resolves.toEqual({ status: "not_found" });
    await expect(lookupCompany("")).resolves.toEqual({ status: "not_found" });
    await expect(lookupCompany(null)).resolves.toEqual({ status: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
