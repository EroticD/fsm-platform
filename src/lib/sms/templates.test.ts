import { describe, expect, it } from "vitest";
import {
  extractSmsTemplateVariables,
  normalizeSmsKeyword,
  renderSmsTemplate,
  sanitizeSmsTemplateVariables,
  smsConsentAction,
  smsLocale,
  validateSmsTemplateBody,
} from "./templates";

describe("SMS-maler", () => {
  it("finner plassholdere én gang hver", () => {
    expect(
      extractSmsTemplateVariables(
        "Hei {contactName}, {workOrderTitle} den {date}. Hei igjen {contactName}.",
      ),
    ).toEqual(["contactName", "workOrderTitle", "date"]);
  });

  it("godtar bare hvitelistede variabler", () => {
    expect(validateSmsTemplateBody("Hei {contactName}!")).toEqual({
      ok: true,
      variables: ["contactName"],
    });
    expect(validateSmsTemplateBody("Hei {hemmelighet}!")).toMatchObject({
      ok: false,
      reason: "unknown_variable",
      unknown: ["hemmelighet"],
    });
    expect(validateSmsTemplateBody("   ")).toMatchObject({
      ok: false,
      reason: "empty",
    });
  });

  it("fyller inn kjente verdier og tømmer ukjente/manglende", () => {
    expect(
      renderSmsTemplate("Hei {contactName}! {workOrderTitle} {trackingUrl}", {
        contactName: "Kari",
        workOrderTitle: "Service",
      }),
    ).toBe("Hei Kari! Service");
  });

  it("filtrerer lagrede variabellister", () => {
    expect(
      sanitizeSmsTemplateVariables([
        "contactName",
        "hemmelighet",
        "contactName",
        42,
      ]),
    ).toEqual(["contactName"]);
  });

  it("faller tilbake til norsk for ukjent locale", () => {
    expect(smsLocale("en")).toBe("en");
    expect(smsLocale("de-DE")).toBe("nb");
    expect(smsLocale(undefined)).toBe("nb");
  });
});

describe("STOP/START", () => {
  const optOut = ["STOP", "STOPP", "MELD AV"];
  const optIn = ["START", "JA", "MELD PÅ"];

  it("normaliserer nøkkelord", () => {
    expect(normalizeSmsKeyword("  meld   av! ")).toBe("MELD AV");
  });

  it("gjenkjenner reservering og nytt samtykke", () => {
    expect(smsConsentAction("stop", optOut, optIn)).toBe("OPT_OUT");
    expect(smsConsentAction("Meld av.", optOut, optIn)).toBe("OPT_OUT");
    expect(smsConsentAction("START", optOut, optIn)).toBe("OPT_IN");
    expect(smsConsentAction("Hei, kan dere ringe?", optOut, optIn)).toBeNull();
  });

  it("krever et helt nøkkelord, ikke en del av en setning", () => {
    expect(smsConsentAction("Jeg vil stoppe abonnementet", optOut, optIn)).toBeNull();
  });
});
