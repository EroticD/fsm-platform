import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isValidOrgNumber,
  listSubUnits,
  lookupCompany,
  normalizeOrgNumber,
  searchCompaniesByName,
  type CompanyRecord,
  type CompanySummary,
  type SubUnit,
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

/** Reelt søkesvar for `?navn=nordlys&size=3`, avkortet til to treff. */
const SOKETREFF = {
  _embedded: {
    enheter: [
      {
        organisasjonsnummer: "985432309",
        navn: "NORDLYS",
        organisasjonsform: { kode: "FLI", beskrivelse: "Forening/lag/innretning" },
        forretningsadresse: {
          postnummer: "5304",
          poststed: "HETLEVIK",
          adresse: ["Nordlysvegen 12"],
        },
        konkurs: false,
        underAvvikling: false,
      },
      {
        organisasjonsnummer: "931944053",
        navn: "NORDLYS SERVICE",
        organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
        postadresse: {
          postnummer: "0953",
          poststed: "OSLO",
          adresse: ["Postboks 900"],
        },
        konkurs: true,
        underTvangsavviklingEllerTvangsopplosning: true,
      },
    ],
  },
  page: { number: 0, size: 2, totalElements: 1375, totalPages: 688 },
};

describe("searchCompaniesByName", () => {
  it("mapper treff til CompanySummary og henter total fra page.totalElements", async () => {
    stubFetch(async () => jsonResponse(SOKETREFF));

    const result = await searchCompaniesByName("nordlys");

    expect(result).toEqual({
      status: "ok",
      total: 1375,
      companies: [
        {
          orgNumber: "985432309",
          name: "NORDLYS",
          organisationForm: "Forening/lag/innretning",
          address: "Nordlysvegen 12",
          postalCode: "5304",
          city: "HETLEVIK",
          bankrupt: false,
          underLiquidation: false,
        },
        {
          orgNumber: "931944053",
          name: "NORDLYS SERVICE",
          organisationForm: "Aksjeselskap",
          address: "Postboks 900",
          postalCode: "0953",
          city: "OSLO",
          bankrupt: true,
          underLiquidation: true,
        },
      ],
    });
  });

  it("bruker page.totalElements som total, ikke antall returnerte rader", async () => {
    stubFetch(async () => jsonResponse(SOKETREFF));

    const result = await searchCompaniesByName("nordlys", 2);

    expect(result.status).toBe("ok");
    const search = result as { status: "ok"; total: number; companies: CompanySummary[] };
    expect(search.companies).toHaveLength(2);
    expect(search.total).toBe(1375);
  });

  it("hopper over treff uten navn", async () => {
    stubFetch(async () =>
      jsonResponse({
        _embedded: {
          enheter: [
            { organisasjonsnummer: "985432309", navn: "NORDLYS" },
            { organisasjonsnummer: "999999999", navn: null },
            { organisasjonsnummer: "888888888", navn: "   " },
            { organisasjonsnummer: "777777777" },
          ],
        },
        page: { totalElements: 4 },
      }),
    );

    const result = await searchCompaniesByName("nordlys");

    expect(result.status).toBe("ok");
    const search = result as { status: "ok"; total: number; companies: CompanySummary[] };
    expect(search.companies.map((company) => company.orgNumber)).toEqual(["985432309"]);
    // Totalen er registerets tall, også når vi filtrerer bort ubrukelige treff.
    expect(search.total).toBe(4);
  });

  it("gir tomt resultat uten nettverk for korte søk", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(SOKETREFF));

    await expect(searchCompaniesByName("")).resolves.toEqual({
      status: "ok",
      companies: [],
      total: 0,
    });
    await expect(searchCompaniesByName("a")).resolves.toEqual({
      status: "ok",
      companies: [],
      total: 0,
    });
    // Mellomrom telles ikke med: «  a  » er fortsatt ett tegn etter trim.
    await expect(searchCompaniesByName("  a  ")).resolves.toEqual({
      status: "ok",
      companies: [],
      total: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returnerer ok med tom liste når registeret ikke har treff", async () => {
    // Reelt svar for et navn uten treff: `_embedded` mangler helt.
    stubFetch(async () =>
      jsonResponse({
        _links: { self: { href: "https://data.brreg.no/enhetsregisteret/api/enheter?navn=zzqqxxyy&size=5" } },
        page: { number: 0, size: 5, totalElements: 0, totalPages: 0 },
      }),
    );

    await expect(searchCompaniesByName("zzqqxxyy")).resolves.toEqual({
      status: "ok",
      companies: [],
      total: 0,
    });
  });

  it("kaller riktig endepunkt med trimmet, kodet søk og standard limit", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(SOKETREFF));

    await searchCompaniesByName("  Nord Lys & Sønn  ");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://data.brreg.no/enhetsregisteret/api/enheter?navn=Nord%20Lys%20%26%20S%C3%B8nn&size=10",
    );
    expect(init.headers).toMatchObject({ Accept: "application/json" });
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("FSM-platform");
    expect(init.next?.revalidate).toBe(86_400);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("respekterer limit og klemmer den til maks 20", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(SOKETREFF));

    await searchCompaniesByName("nordlys", 5);
    expect(fetchMock.mock.calls[0][0]).toContain("size=5");

    await searchCompaniesByName("nordlys", 500);
    expect(fetchMock.mock.calls[1][0]).toContain("size=20");

    await searchCompaniesByName("nordlys", 0);
    expect(fetchMock.mock.calls[2][0]).toContain("size=10");

    await searchCompaniesByName("nordlys", Number.NaN);
    expect(fetchMock.mock.calls[3][0]).toContain("size=10");
  });

  it("returnerer unavailable for 500 og for nettverksfeil", async () => {
    stubFetch(async () => new Response("", { status: 500 }));
    await expect(searchCompaniesByName("nordlys")).resolves.toEqual({
      status: "unavailable",
    });

    stubFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(searchCompaniesByName("nordlys")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("returnerer unavailable når svaret ikke er JSON", async () => {
    stubFetch(
      async () =>
        new Response("<html>feil</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );

    await expect(searchCompaniesByName("nordlys")).resolves.toEqual({
      status: "unavailable",
    });
  });
});

/** Reelt underenhetssvar for Equinor ASA (923609016), forkortet. */
const UNDERENHETER = {
  _embedded: {
    underenheter: [
      {
        organisasjonsnummer: "973861883",
        navn: "EQUINOR ASA AVD CCB SOTRA",
        organisasjonsform: { kode: "BEDR", beskrivelse: "Underenhet" },
        // Underenheter har `beliggenhetsadresse`, ikke `forretningsadresse`.
        beliggenhetsadresse: {
          adresse: ["Kolltveitvegen 3"],
          postnummer: "5347",
          poststed: "ÅGOTNES",
        },
        // Postadressen er hovedkontorets og skal ikke vinne over beliggenheten.
        postadresse: {
          adresse: ["Den norske stats oljeselskap as"],
          postnummer: "4035",
          poststed: "STAVANGER",
        },
      },
      {
        organisasjonsnummer: "991770526",
        navn: "EQUINOR ASA AVD CSO GBS PRS PURCHASING",
        // Ingen adresse i det hele tatt.
      },
    ],
  },
  page: { number: 0, size: 100, totalElements: 2, totalPages: 1 },
};

describe("listSubUnits", () => {
  it("mapper underenheter med beliggenhetsadresse", async () => {
    stubFetch(async () => jsonResponse(UNDERENHETER));

    const result = await listSubUnits("NO 923 609 016 MVA");

    expect(result).toEqual({
      status: "ok",
      units: [
        {
          orgNumber: "973861883",
          name: "EQUINOR ASA AVD CCB SOTRA",
          address: "Kolltveitvegen 3",
          postalCode: "5347",
          city: "ÅGOTNES",
        },
        {
          orgNumber: "991770526",
          name: "EQUINOR ASA AVD CSO GBS PRS PURCHASING",
          address: null,
          postalCode: null,
          city: null,
        },
      ],
    });
  });

  it("kaller riktig endepunkt med normalisert orgnr og size=100", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(UNDERENHETER));

    await listSubUnits("923 609 016");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://data.brreg.no/enhetsregisteret/api/underenheter?overordnetEnhet=923609016&size=100",
    );
    expect(init.headers).toMatchObject({ Accept: "application/json" });
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("FSM-platform");
    expect(init.next?.revalidate).toBe(86_400);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("faller tilbake til postadresse når forretnings- og beliggenhetsadresse mangler", async () => {
    stubFetch(async () =>
      jsonResponse({
        _embedded: {
          underenheter: [
            {
              organisasjonsnummer: "994667084",
              navn: "NORDLYS SERVICE AS AVD NARVIK",
              postadresse: {
                adresse: ["Teknologiveien 10"],
                postnummer: "8517",
                poststed: "NARVIK",
              },
            },
          ],
        },
      }),
    );

    const result = await listSubUnits("974760673");

    expect(result).toMatchObject({
      status: "ok",
      units: [{ address: "Teknologiveien 10", postalCode: "8517", city: "NARVIK" }],
    });
  });

  it("gir tom streng for navn og null for adresse når feltene mangler", async () => {
    stubFetch(async () =>
      jsonResponse({
        _embedded: {
          underenheter: [
            {
              organisasjonsnummer: "994667084",
              navn: null,
              beliggenhetsadresse: {},
            },
          ],
        },
      }),
    );

    const result = await listSubUnits("974760673");

    expect(result.status).toBe("ok");
    const units = (result as { status: "ok"; units: SubUnit[] }).units;
    expect(units).toEqual([
      {
        orgNumber: "994667084",
        name: "",
        address: null,
        postalCode: null,
        city: null,
      },
    ]);
    for (const value of Object.values(units[0])) {
      expect(value).not.toBeUndefined();
    }
  });

  it("gir ok med tom liste når hovedenheten ikke har underenheter", async () => {
    stubFetch(async () => jsonResponse({ page: { totalElements: 0 } }));

    await expect(listSubUnits("923609016")).resolves.toEqual({
      status: "ok",
      units: [],
    });
  });

  it("returnerer not_found for 404", async () => {
    stubFetch(async () => new Response("", { status: 404 }));

    await expect(listSubUnits("923609016")).resolves.toEqual({
      status: "not_found",
    });
  });

  it("returnerer unavailable for 500 og for nettverksfeil", async () => {
    stubFetch(async () => new Response("", { status: 500 }));
    await expect(listSubUnits("923609016")).resolves.toEqual({
      status: "unavailable",
    });

    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(listSubUnits("923609016")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("gjør ingen oppslag når organisasjonsnummeret er ugyldig", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(UNDERENHETER));

    await expect(listSubUnits("123")).resolves.toEqual({ status: "not_found" });
    await expect(listSubUnits("")).resolves.toEqual({ status: "not_found" });
    await expect(listSubUnits(null)).resolves.toEqual({ status: "not_found" });
    await expect(listSubUnits(923609016)).resolves.toEqual({
      status: "not_found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
