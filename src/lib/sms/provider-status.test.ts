import { describe, expect, it } from "vitest";
import {
  getSmsProvider,
  normalizeSmsStatus,
  type SmsWebhookRequest,
} from "./provider";

function request(rawBody: string, contentType = "application/json"): SmsWebhookRequest {
  return {
    rawBody,
    headers: new Headers({ "content-type": contentType }),
    url: "http://localhost/api/webhooks/sms/test",
  };
}

describe("SMS-leveringsstatus", () => {
  it("normaliserer leverandørenes statusnavn", () => {
    expect(normalizeSmsStatus("delivered")).toBe("DELIVERED");
    expect(normalizeSmsStatus("DELIVRD")).toBe("DELIVERED");
    expect(normalizeSmsStatus("sent")).toBe("SENT");
    expect(normalizeSmsStatus("undelivered")).toBe("FAILED");
    expect(normalizeSmsStatus("queued")).toBeNull();
    expect(normalizeSmsStatus("")).toBeNull();
  });

  it("leser JSON-status fra console/linkmobility", () => {
    const status = getSmsProvider("console").parseStatus(
      request(
        JSON.stringify({
          id: "msg-1",
          status: "delivered",
          timestamp: "2026-11-03T10:00:00.000Z",
        }),
      ),
    );
    expect(status).toMatchObject({
      provider: "console",
      providerId: "msg-1",
      status: "DELIVERED",
    });
    expect(status?.occurredAt).toBeInstanceOf(Date);
  });

  it("leser Twilio-statuscallback fra form-body", () => {
    const status = getSmsProvider("twilio").parseStatus(
      request(
        "MessageSid=SM123&MessageStatus=failed&ErrorCode=30003",
        "application/x-www-form-urlencoded",
      ),
    );
    expect(status).toMatchObject({
      provider: "twilio",
      providerId: "SM123",
      status: "FAILED",
      error: "30003",
    });
  });

  it("leser PSWinCom-statuscallback fra XML", () => {
    const status = getSmsProvider("pswincom").parseStatus(
      request("<DELIVERY><ID>42</ID><STATUS>DELIVRD</STATUS></DELIVERY>", "text/xml"),
    );
    expect(status).toMatchObject({
      provider: "pswincom",
      providerId: "42",
      status: "DELIVERED",
    });
  });

  it("avviser en vanlig innkommende melding som status", () => {
    const status = getSmsProvider("console").parseStatus(
      request(
        JSON.stringify({
          id: "inbound-1",
          from: "4790000000",
          to: "4700000000",
          body: "Hei",
        }),
      ),
    );
    expect(status).toBeNull();
  });
});
