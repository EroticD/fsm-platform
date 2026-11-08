import { describe, expect, it } from "vitest";
import {
  normalizeSamlCertificate,
  readSamlConfig,
  samlClaimsFromProfile,
  samlProviderBySlug,
  samlSsoConfig,
} from "./saml";
import { parseSamlMetadata } from "@/server/saml";
import { ssoDepartmentFromClaims } from "@/lib/sso";
import { SAML_TEST_CERT, testSamlConfig } from "@/test/saml-fixture";

function baseEnv(): Record<string, string> {
  return {
    APP_URL: "https://fsm.example",
    SAML_PROVIDERS: "entra",
    SAML_ENTRA_DISPLAY_NAME: "Entra SAML",
    SAML_ENTRA_ENTRY_POINT: "https://login.example.no/saml2",
    SAML_ENTRA_IDP_CERT: SAML_TEST_CERT,
    SAML_ENTRA_IDP_ISSUER: "https://idp.example/metadata",
    SAML_ENTRA_ALLOWED_EMAIL_DOMAINS: "Example.no,@firma.no",
    SAML_ENTRA_GROUP_ROLE_MAP: '{"FSM-Office":"OFFICE"}',
    SAML_ENTRA_GROUP_DEPARTMENT_MAP: '{"FSM-Oslo":"Oslo"}',
  };
}

describe("readSamlConfig", () => {
  it("leser en leverandør med trygge standardverdier", () => {
    const config = readSamlConfig(baseEnv());
    expect(config.errors).toEqual([]);
    expect(config.providers).toHaveLength(1);

    const provider = config.providers[0];
    expect(provider).toMatchObject({
      slug: "entra",
      id: "saml-entra",
      protocol: "saml",
      displayName: "Entra SAML",
      acsUrl: "https://fsm.example/api/auth/saml/entra/acs",
      spEntityId: "https://fsm.example/api/auth/saml/entra/metadata",
      audience: "https://fsm.example/api/auth/saml/entra/metadata",
      wantAssertionsSigned: true,
      wantResponseSigned: false,
      allowIdpInitiated: false,
      autoProvision: false,
      autoProvisionActive: false,
      defaultRole: "USER",
      groupsAttribute: "groups",
      emailAttribute: "email",
    });
    expect(provider.allowedEmailDomains).toEqual(["example.no", "firma.no"]);
    expect(provider.groupRoleMap).toEqual({ "FSM-Office": "OFFICE" });
    expect(provider.groupDepartmentMap).toEqual({ "FSM-Oslo": "Oslo" });
  });

  it("krever entry point eller metadata og sertifikat", () => {
    const config = readSamlConfig({
      APP_URL: "https://fsm.example",
      SAML_PROVIDERS: "entra",
      SAML_ENTRA_DISPLAY_NAME: "Entra",
    });
    expect(config.providers).toEqual([]);
    expect(config.errors.join(" ")).toContain("ENTRY_POINT");
    expect(config.errors.join(" ")).toContain("IDP_CERT");
  });

  it("avviser CUSTOMER som standardrolle eller mapping", () => {
    const config = readSamlConfig({
      ...baseEnv(),
      SAML_ENTRA_DEFAULT_ROLE: "CUSTOMER",
      SAML_ENTRA_GROUP_ROLE_MAP: '{"Alle":"CUSTOMER"}',
    });
    expect(config.errors.join(" ")).toContain("DEFAULT_ROLE");
    expect(config.errors.join(" ")).toContain("CUSTOMER");
  });

  it("krever privatnøkkel når AuthnRequest skal signeres", () => {
    const config = readSamlConfig({
      ...baseEnv(),
      SAML_ENTRA_SIGN_AUTHN_REQUEST: "true",
    });
    expect(config.errors.join(" ")).toContain("SP_PRIVATE_KEY");
  });

  it("hopper over en deaktivert leverandør uten å kreve felter", () => {
    const config = readSamlConfig({
      SAML_PROVIDERS: "entra",
      SAML_ENTRA_ENABLED: "false",
    });
    expect(config.providers).toEqual([]);
    expect(config.errors).toEqual([]);
  });

  it("slår opp på slug", () => {
    expect(samlProviderBySlug("entra", baseEnv())?.slug).toBe("entra");
    expect(samlProviderBySlug("ukjent", baseEnv())).toBeNull();
  });
});

describe("SAML-hjelpere", () => {
  it("normaliserer et sertifikat uten PEM-headere", () => {
    const raw = SAML_TEST_CERT.replace(
      /-----(BEGIN|END) CERTIFICATE-----/g,
      "",
    ).replace(/\s+/g, "");
    expect(normalizeSamlCertificate(raw)).toBe(SAML_TEST_CERT.trim());
  });

  it("leser entry point og sertifikat fra IdP-metadata", () => {
    const metadata = parseSamlMetadata(`<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example/metadata">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${SAML_TEST_CERT.replace(
      /-----(BEGIN|END) CERTIFICATE-----/g,
      "",
    ).replace(/\s+/g, "")}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`);

    expect(metadata.entryPoint).toBe("https://idp.example/sso");
    expect(metadata.entityId).toBe("https://idp.example/metadata");
    expect(metadata.idpCert).toContain("BEGIN CERTIFICATE");
  });

  it("oversetter en profil til de felles claimene", () => {
    const config = testSamlConfig({ departmentAttribute: "department" });
    const claims = samlClaimsFromProfile(
      {
        nameID: "subject-1",
        email: "kari@example.no",
        displayName: "Kari Test",
        groups: ["FSM-Office", "FSM-Oslo"],
        department: "Oslo",
      },
      config,
    );

    expect(claims).toMatchObject({
      sub: "subject-1",
      email: "kari@example.no",
      email_verified: true,
      name: "Kari Test",
      groups: ["FSM-Office", "FSM-Oslo"],
      department: "Oslo",
    });
  });

  it("velger avdeling fra claim før gruppemapping og avviser konflikt", () => {
    const config = {
      departmentClaim: "department",
      groupDepartmentMap: { "FSM-Oslo": "Oslo", "FSM-Bergen": "Bergen" },
    };
    expect(
      ssoDepartmentFromClaims({ department: "Trondheim" }, ["FSM-Oslo"], config),
    ).toMatchObject({ department: "Trondheim", conflict: [] });

    expect(
      ssoDepartmentFromClaims(
        {},
        ["FSM-Oslo", "FSM-Bergen"],
        config,
      ),
    ).toMatchObject({
      department: null,
      conflict: ["Oslo", "Bergen"],
    });
  });

  it("bevarer eksplisitt rolle- og avdelingsmapping i den felles konfigurasjonen", () => {
    const sso = samlSsoConfig(
      testSamlConfig({
        groupRoleMap: { "FSM-Office": "OFFICE" },
        groupDepartmentMap: { "FSM-Oslo": "Oslo" },
        departmentAttribute: "department",
        syncRoles: true,
        syncDepartment: true,
      }),
    );
    expect(sso).toMatchObject({
      protocol: "saml",
      groupsClaim: "groups",
      groupRoleMap: { "FSM-Office": "OFFICE" },
      groupDepartmentMap: { "FSM-Oslo": "Oslo" },
      departmentClaim: "department",
      syncRoles: true,
      syncDepartment: true,
    });
  });
});
