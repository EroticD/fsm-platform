import { describe, expect, it } from "vitest";
import {
  parseGroupRoleMap,
  readSsoConfig,
  ssoDiscoveryUrl,
  ssoEmail,
  ssoEmailDomainAllowed,
  ssoEmailVerified,
  ssoGroups,
  ssoProviderById,
  ssoRoleFromGroups,
  ssoSubject,
  ssoTwoFactorGate,
} from "./sso";

function baseEnv(): Record<string, string> {
  return {
    SSO_PROVIDERS: "entra,keycloak",
    SSO_ENTRA_ISSUER:
      "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0",
    SSO_ENTRA_CLIENT_ID: "entra-client",
    SSO_ENTRA_CLIENT_SECRET: "entra-secret",
    SSO_ENTRA_DISPLAY_NAME: "Microsoft Entra ID",
    SSO_KEYCLOAK_ISSUER: "https://sso.example.no/realms/fsm",
    SSO_KEYCLOAK_CLIENT_ID: "keycloak-client",
    SSO_KEYCLOAK_CLIENT_SECRET: "keycloak-secret",
    SSO_KEYCLOAK_ALLOWED_EMAIL_DOMAINS: "Example.no, @firma.no",
    SSO_KEYCLOAK_GROUP_ROLE_MAP:
      '{"FSM-Admins":"ADMIN","FSM-Office":"OFFICE"}',
  };
}

describe("readSsoConfig", () => {
  it("leser flere leverandører med trygge standardverdier", () => {
    const config = readSsoConfig(baseEnv());

    expect(config.errors).toEqual([]);
    expect(config.providers).toHaveLength(2);

    const entra = config.providers[0];
    expect(entra.id).toBe("sso-entra");
    expect(entra.slug).toBe("entra");
    expect(entra.displayName).toBe("Microsoft Entra ID");
    expect(entra.discoveryUrl).toBe(
      "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0/.well-known/openid-configuration",
    );
    expect(entra.scopes).toEqual(["openid", "email", "profile"]);
    expect(entra.autoProvision).toBe(false);
    expect(entra.autoProvisionActive).toBe(false);
    expect(entra.defaultRole).toBe("USER");
    expect(entra.syncRoles).toBe(false);
    expect(entra.allowedEmailDomains).toEqual([]);

    const keycloak = config.providers[1];
    expect(keycloak.allowedEmailDomains).toEqual(["example.no", "firma.no"]);
    expect(keycloak.groupRoleMap).toEqual({
      "FSM-Admins": "ADMIN",
      "FSM-Office": "OFFICE",
    });
  });

  it("hopper over en leverandør som er eksplisitt slått av", () => {
    const config = readSsoConfig({
      ...baseEnv(),
      SSO_ENTRA_ENABLED: "false",
      SSO_ENTRA_CLIENT_SECRET: "",
    });
    expect(config.providers.map((provider) => provider.slug)).toEqual([
      "keycloak",
    ]);
    expect(config.errors).toEqual([]);
  });

  it("rapporterer manglende og ugyldige påkrevde felt", () => {
    const config = readSsoConfig({
      SSO_PROVIDERS: "entra",
      SSO_ENTRA_ISSUER: "ikke-en-url",
      SSO_ENTRA_CLIENT_ID: "",
      SSO_ENTRA_CLIENT_SECRET: "",
      SSO_ENTRA_DISPLAY_NAME: "",
    });

    expect(config.providers).toEqual([]);
    expect(config.errors.join(" ")).toContain("discovery-URL");
    expect(config.errors.join(" ")).toContain("CLIENT_ID");
    expect(config.errors.join(" ")).toContain("CLIENT_SECRET");
  });

  it("avviser dupliserte sluger og ugyldige navn", () => {
    const config = readSsoConfig({
      ...baseEnv(),
      SSO_PROVIDERS: "entra,entra,Bad Slug",
    });
    expect(config.errors.join(" ")).toContain("flere ganger");
    expect(config.errors.join(" ")).toContain("ugyldig leverandørnavn");
  });

  it("bruker eksplisitt discovery-URL og legger til openid i scopes", () => {
    const config = readSsoConfig({
      SSO_PROVIDERS: "zitadel",
      SSO_ZITADEL_DISCOVERY_URL:
        "https://auth.example.no/.well-known/openid-configuration",
      SSO_ZITADEL_CLIENT_ID: "id",
      SSO_ZITADEL_CLIENT_SECRET: "secret",
      SSO_ZITADEL_SCOPES: "email,profile",
    });
    expect(config.errors).toEqual([]);
    expect(config.providers[0].discoveryUrl).toBe(
      "https://auth.example.no/.well-known/openid-configuration",
    );
    expect(config.providers[0].scopes).toEqual(["openid", "email", "profile"]);
  });

  it("avviser CUSTOMER som standardrolle eller gruppemapping", () => {
    const config = readSsoConfig({
      ...baseEnv(),
      SSO_ENTRA_DEFAULT_ROLE: "CUSTOMER",
      SSO_ENTRA_GROUP_ROLE_MAP: '{"Alle":"CUSTOMER"}',
    });
    expect(config.errors.join(" ")).toContain("DEFAULT_ROLE");
    expect(config.errors.join(" ")).toContain("gruppemapping");
  });
});

describe("ssoDiscoveryUrl", () => {
  it("fjerner avsluttende skråstrek", () => {
    expect(ssoDiscoveryUrl("https://id.example.no/")).toBe(
      "https://id.example.no/.well-known/openid-configuration",
    );
  });
});

describe("parseGroupRoleMap", () => {
  it("godtar gruppe=ROLLE og normaliserer rollen", () => {
    expect(parseGroupRoleMap("FSM-Office=office, FSM-Felt = TECHNICIAN")).toEqual({
      map: { "FSM-Office": "OFFICE", "FSM-Felt": "TECHNICIAN" },
      error: null,
    });
  });

  it("avviser ugyldig JSON", () => {
    expect(parseGroupRoleMap('{"a":').error).toContain("JSON");
  });
});

describe("claims", () => {
  it("bruker sub som identitet og preferred_username som e-post", () => {
    const claims = {
      sub: "abc-123",
      preferred_username: "  Kari.Firma@Example.NO ",
      email_verified: true,
      name: "Kari Firma",
    };
    expect(ssoSubject(claims)).toBe("abc-123");
    expect(ssoEmail(claims)).toBe("kari.firma@example.no");
    expect(ssoEmailVerified(claims)).toBe(true);
  });

  it("godtar Entra xms_edov som bekreftet e-post", () => {
    expect(ssoEmailVerified({ xms_edov: true })).toBe(true);
    expect(ssoEmailVerified({ email_verified: false })).toBe(false);
    expect(ssoEmailVerified({})).toBe(false);
  });

  it("leser grupper fra liste, objekter og Zitadel-rolleobjekt", () => {
    expect(ssoGroups({ groups: ["A", "B"] }, "groups")).toEqual(["A", "B"]);
    expect(
      ssoGroups({ groups: [{ display: "A" }, { value: "B" }] }, "groups"),
    ).toEqual(["A", "B"]);
    expect(
      ssoGroups(
        { "urn:zitadel:iam:org:project:roles": { FSM: { org: true } } },
        "urn:zitadel:iam:org:project:roles",
      ),
    ).toEqual(["FSM"]);
  });

  it("gir konflikt når gruppene peker på ulike roller", () => {
    const mapping = ssoRoleFromGroups(["A", "B"], {
      A: "OFFICE",
      B: "ADMIN",
    });
    expect(mapping.role).toBeNull();
    expect(mapping.conflict).toEqual(["OFFICE", "ADMIN"]);
  });

  it("gir én rolle når gruppene er entydige", () => {
    expect(
      ssoRoleFromGroups(["A", "B"], { A: "OFFICE", B: "OFFICE" }).role,
    ).toBe("OFFICE");
  });

  it("sjekker tillatte e-postdomener", () => {
    expect(ssoEmailDomainAllowed("Kari@Example.no", ["example.no"])).toBe(true);
    expect(ssoEmailDomainAllowed("kari@annet.no", ["example.no"])).toBe(false);
    expect(ssoEmailDomainAllowed("kari@annet.no", [])).toBe(true);
  });
});

describe("ssoTwoFactorGate", () => {
  it("krever kode når brukeren allerede har 2FA", () => {
    expect(
      ssoTwoFactorGate({ role: "TECHNICIAN", isTwoFactorEnabled: true }, {}),
    ).toBe("verify");
  });

  it("krever oppsett når rollen er pålagt 2FA", () => {
    expect(
      ssoTwoFactorGate(
        { role: "ADMIN", isTwoFactorEnabled: false },
        { REQUIRE_2FA_ROLES: "ADMIN,OFFICE" },
      ),
    ).toBe("enroll");
  });

  it("slipper gjennom når 2FA er valgfritt", () => {
    expect(
      ssoTwoFactorGate(
        { role: "TECHNICIAN", isTwoFactorEnabled: false },
        { REQUIRE_2FA_ROLES: "ADMIN" },
      ),
    ).toBe("ok");
  });
});

describe("ssoProviderById", () => {
  it("finner bare konfigurerte leverandører", () => {
    expect(ssoProviderById("sso-keycloak", baseEnv())?.slug).toBe("keycloak");
    expect(ssoProviderById("sso-ukjent", baseEnv())).toBeNull();
  });
});
