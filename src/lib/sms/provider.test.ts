import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSmsProvider,
  hmacSha256Hex,
  resolveSmsProviderName,
  safeCompareStrings,
  smsProviderInfo,
  verifySmsSignature,
} from "./provider";

function jsonHeaders(extra: Record<string, string> = {}) {
  return new Headers({ "content-type": "application/json", ...extra });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SMS_PROVIDER;
  delete process.env.SMS_WEBHOOK_SECRET;
  delete process.env.SMS_LINKMOBILITY_SECRET;
  delete process.env.SMS_PSWINCOM_SECRET;
  delete process.env.SMS_TWILIO_AUTH_TOKEN;
  delete process.env.SMS_ALLOWLIST;
  delete process.env.SMS_LINKMOBILITY_URL;
  delete process.env.SMS_LINKMOBILITY_API_KEY;
  delete process.env.SMS_PSWINCOM_URL;
  delete process.env.SMS_TWILIO_ACCOUNT_SID;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.SMS_LINKMOBILITY_URL;
  delete process.env.SMS_LINKMOBILITY_API_KEY;
});

describe("SMS-leverandørvalg", () => {
  it("bruker console som standard og tørrkjøring", () => {
    expect(resolveSmsProviderName(undefined)).toBe("console");
    expect(resolveSmsProviderName("ukjent")).toBe("console");
    expect(smsProviderInfo()).toMatchObject({ provider: "console", dryRun: true });
  });

  it("leser leverandør fra SMS_PROVIDER", () => {
    process.env.SMS_PROVIDER = "TWILIO";
    expect(resolveSmsProviderName()).toBe("twilio");
    expect(smsProviderInfo().dryRun).toBe(false);
  });

  it("console-provideren sender aldri over nettverket", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSmsProvider("console").send({
      to: "+4790000000",
      body: "Hei",
    });

    expect(result.dryRun).toBe(true);
    expect(result.providerId).toMatch(/^console-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("signaturverifisering", () => {
  it("godtar gyldig HMAC med tidsstempel", () => {
    process.env.SMS_WEBHOOK_SECRET = "hemmelig";
    const rawBody = '{"id":"m1","from":"4790000000","to":"4700000000","body":"Hei"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = hmacSha256Hex("hemmelig", `${timestamp}.${rawBody}`);

    expect(
      verifySmsSignature("linkmobility", {
        rawBody,
        url: "https://example.test/api/webhooks/sms/linkmobility",
        headers: jsonHeaders({
          "x-sms-timestamp": timestamp,
          "x-sms-signature": signature,
        }),
      }),
    ).toBe(true);
  });

  it("avviser feil signatur og for gammelt tidsstempel", () => {
    process.env.SMS_WEBHOOK_SECRET = "hemmelig";
    const rawBody = '{"id":"m1"}';
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const signature = hmacSha256Hex("hemmelig", `${old}.${rawBody}`);

    expect(
      verifySmsSignature("linkmobility", {
        rawBody,
        headers: jsonHeaders({
          "x-sms-timestamp": old,
          "x-sms-signature": signature,
        }),
      }),
    ).toBe(false);
    expect(
      verifySmsSignature("linkmobility", {
        rawBody,
        headers: jsonHeaders({ "x-sms-signature": "feil" }),
      }),
    ).toBe(false);
  });

  it("verifiserer Twilios URL-baserte signatur", () => {
    process.env.SMS_TWILIO_AUTH_TOKEN = "token";
    const url = "https://example.test/api/webhooks/sms/twilio";
    const rawBody = new URLSearchParams({
      To: "+4700000000",
      Body: "Hei",
      From: "+4790000000",
      MessageSid: "SM123",
    }).toString();
    const params = new URLSearchParams(rawBody);
    const data = [...params.keys()]
      .sort()
      .reduce((acc, key) => acc + key + (params.get(key) ?? ""), url);
    const signature = crypto
      .createHmac("sha1", "token")
      .update(data, "utf8")
      .digest("base64");

    expect(
      verifySmsSignature("twilio", {
        rawBody,
        url,
        headers: new Headers({ "x-twilio-signature": signature }),
      }),
    ).toBe(true);
  });

  it("console uten hemmelighet er bare tillatt utenfor produksjon", () => {
    const request = {
      rawBody: "{}",
      headers: new Headers(),
      url: "https://example.test",
    };
    vi.stubEnv("NODE_ENV", "test");
    expect(verifySmsSignature("console", request)).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(verifySmsSignature("console", request)).toBe(false);
  });

  it("sammenligner strenger i konstant tid uten lengdelekkasje", () => {
    expect(safeCompareStrings("a", "a")).toBe(true);
    expect(safeCompareStrings("a", "b")).toBe(false);
    expect(safeCompareStrings("kort", "mye lengre verdi")).toBe(false);
  });
});

describe("webhook-parsing", () => {
  it("parser console/linkmobility JSON", () => {
    const provider = getSmsProvider("linkmobility");
    const parsed = provider.parseWebhook({
      rawBody: JSON.stringify({
        id: "lm-1",
        sender: "4790000000",
        receiver: "4700000000",
        message: "Hei",
      }),
      headers: jsonHeaders(),
    });

    expect(parsed).toMatchObject({
      provider: "linkmobility",
      providerId: "lm-1",
      from: "4790000000",
      to: "4700000000",
      body: "Hei",
    });
  });

  it("parser PSWinCom XML", () => {
    const parsed = getSmsProvider("pswincom").parseWebhook({
      rawBody:
        "<SMS><ID>psw-1</ID><SENDER>4790000000</SENDER><RECEIVER>4700000000</RECEIVER><MSG><![CDATA[Hei]]></MSG></SMS>",
      headers: new Headers({ "content-type": "application/xml" }),
    });

    expect(parsed).toMatchObject({
      provider: "pswincom",
      providerId: "psw-1",
      body: "Hei",
    });
  });

  it("parser Twilio formdata", () => {
    const parsed = getSmsProvider("twilio").parseWebhook({
      rawBody: new URLSearchParams({
        MessageSid: "SM123",
        From: "+4790000000",
        To: "+4700000000",
        Body: "Hei",
      }).toString(),
      headers: new Headers({
        "content-type": "application/x-www-form-urlencoded",
      }),
    });

    expect(parsed).toMatchObject({
      provider: "twilio",
      providerId: "SM123",
      from: "+4790000000",
      body: "Hei",
    });
  });

  it("avviser payload uten leverandør-id", () => {
    expect(
      getSmsProvider("console").parseWebhook({
        rawBody: JSON.stringify({ from: "1", to: "2", body: "Hei" }),
        headers: jsonHeaders(),
      }),
    ).toBeNull();
  });
});

describe("utgående sending", () => {
  it("sender Link Mobility med fetch og leser id fra svaret", async () => {
    process.env.SMS_LINKMOBILITY_URL = "https://lm.example.test/send";
    process.env.SMS_LINKMOBILITY_API_KEY = "api-key";
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: "lm-42" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSmsProvider("linkmobility").send({
      to: "+4790000000",
      body: "Hei",
      senderId: "FSM",
    });

    expect(result).toMatchObject({
      provider: "linkmobility",
      providerId: "lm-42",
      dryRun: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lm.example.test/send",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("feiler tydelig når leverandøren mangler konfigurasjon", async () => {
    await expect(
      getSmsProvider("linkmobility").send({ to: "+4790000000", body: "Hei" }),
    ).rejects.toMatchObject({ code: "not_configured" });
  });
});
