import { describe, expect, it } from "vitest";
import { describeAuditAction } from "./audit-actions";

const translate = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

describe("describeAuditAction", () => {
  it("oversetter lagrede oppdragshendelser via stabile nøkler", () => {
    expect(
      describeAuditAction(
        "Kontoret opprettet nytt oppdrag: Service",
        translate,
      ),
    ).toBe(
      'auditActions.workOrder.created:{"title":"Service"}',
    );
  });

  it("oversetter nye bruker- og dokumenthendelser", () => {
    expect(
      describeAuditAction("Opprettet bruker: Kari (Montør)", translate),
    ).toBe(
      'auditActions.users.created:{"name":"Kari","role":"Montør"}',
    );
    expect(
      describeAuditAction(
        "Flyttet dokumentet «Manual» til mappen Drift",
        translate,
      ),
    ).toBe(
      'auditActions.documents.movedToFolder:{"title":"Manual","folder":"Drift"}',
    );
  });

  it("oversetter 2FA-hendelser", () => {
    expect(
      describeAuditAction("Slå på to-trinns verifisering", translate),
    ).toBe("auditActions.security.twoFactorEnabled");
  });

  it("returnerer null for ukjente, eldre handlinger", () => {
    expect(describeAuditAction("En helt egen handling", translate)).toBeNull();
    expect(describeAuditAction("", translate)).toBeNull();
  });
});
