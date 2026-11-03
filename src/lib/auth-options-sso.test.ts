import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSsoUser: vi.fn(),
  recordSsoLogin: vi.fn(),
  setPendingTwoFactor: vi.fn(),
  provider: {
    slug: "entra",
    id: "sso-entra",
    displayName: "Microsoft Entra ID",
    issuer: "https://login.example.no/tenant/v2.0",
    discoveryUrl:
      "https://login.example.no/tenant/v2.0/.well-known/openid-configuration",
    clientId: "client",
    clientSecret: "secret",
    scopes: ["openid", "email", "profile"],
    autoProvision: false,
    autoProvisionActive: false,
    defaultRole: "USER",
    defaultDepartment: null,
    allowedEmailDomains: [],
    groupsClaim: "groups",
    groupRoleMap: {},
    syncRoles: false,
  },
}));

vi.mock("@/lib/credentials", () => ({
  verifyCredentials: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  bumpSessionVersion: vi.fn(),
}));
vi.mock("@/lib/session-token", () => ({
  clearRecoveryCodesForDisplay: vi.fn(),
  setPendingTwoFactor: mocks.setPendingTwoFactor,
}));
vi.mock("@/server/sso", () => ({
  resolveSsoUser: mocks.resolveSsoUser,
  recordSsoLogin: mocks.recordSsoLogin,
}));
vi.mock("@/lib/sso", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sso")>();
  return {
    ...actual,
    readSsoConfig: () => ({ providers: [mocks.provider], errors: [] }),
    ssoProviderById: (id: string) =>
      id === mocks.provider.id ? mocks.provider : null,
  };
});

import { authOptions } from "./auth-options";

const signIn = authOptions.callbacks!.signIn!;

function callSignIn(input: {
  provider: string;
  claims?: Record<string, unknown>;
  user?: Record<string, unknown>;
}) {
  return signIn({
    user: {
      id: "",
      email: null,
      name: null,
      ...(input.user ?? {}),
    },
    account: {
      provider: input.provider,
      providerAccountId: "subject-1",
      type: "oauth",
    },
    profile: input.claims ?? {
      sub: "subject-1",
      email: "kari@example.no",
      email_verified: true,
      name: "Kari",
    },
  } as never);
}

function sessionUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "kari@example.no",
    name: "Kari",
    role: "TECHNICIAN",
    isActive: true,
    isTwoFactorEnabled: false,
    sessionVersion: 4,
    departmentId: "dep-a",
    customerId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordSsoLogin.mockResolvedValue(undefined);
  mocks.setPendingTwoFactor.mockResolvedValue(undefined);
});

describe("authOptions – SSO-provider", () => {
  it("registrerer en OIDC-provider med discovery, PKCE, state og nonce", () => {
    const provider = authOptions.providers.find((item) => item.id === "sso-entra") as
      | Record<string, unknown>
      | undefined;
    expect(provider).toBeTruthy();
    expect(provider).toMatchObject({
      id: "sso-entra",
      name: "Microsoft Entra ID",
      wellKnown: mocks.provider.discoveryUrl,
      clientId: "client",
      checks: ["pkce", "state", "nonce"],
      idToken: true,
    });
    expect(provider).toHaveProperty("profile");
  });
});

describe("authOptions – signIn for SSO", () => {
  it("slipper gjennom uten 2FA og setter lokal id, rolle og øktversjon", async () => {
    mocks.resolveSsoUser.mockResolvedValue({
      ok: true,
      user: sessionUser(),
      provisioned: false,
      linked: true,
      roleChanged: false,
      matchedGroups: [],
    });
    const user = { id: "", email: null, name: null } as Record<string, unknown>;

    const result = await signIn({
      user,
      account: {
        provider: "sso-entra",
        providerAccountId: "subject-1",
        type: "oauth",
      },
      profile: {
        sub: "subject-1",
        email: "kari@example.no",
        email_verified: true,
      },
    } as never);

    expect(result).toBe(true);
    expect(user).toMatchObject({
      id: "u1",
      email: "kari@example.no",
      role: "TECHNICIAN",
      sessionVersion: 4,
    });
    expect(mocks.recordSsoLogin).toHaveBeenCalled();
    expect(mocks.setPendingTwoFactor).not.toHaveBeenCalled();
  });

  it("sender en bruker med 2FA til kode-steget uten å lage sesjon", async () => {
    mocks.resolveSsoUser.mockResolvedValue({
      ok: true,
      user: sessionUser({ isTwoFactorEnabled: true }),
      provisioned: false,
      linked: false,
      roleChanged: false,
      matchedGroups: [],
    });

    const result = await callSignIn({ provider: "sso-entra" });

    expect(result).toBe("/logg-inn/2fa");
    expect(mocks.setPendingTwoFactor).toHaveBeenCalledWith("u1");
  });

  it("sender en privilegert bruker til påkrevd 2FA-oppsett", async () => {
    const original = process.env.REQUIRE_2FA_ROLES;
    process.env.REQUIRE_2FA_ROLES = "ADMIN,OFFICE";
    try {
      mocks.resolveSsoUser.mockResolvedValue({
        ok: true,
        user: sessionUser({ role: "ADMIN" }),
        provisioned: false,
        linked: false,
        roleChanged: false,
        matchedGroups: [],
      });

      const result = await callSignIn({ provider: "sso-entra" });
      expect(result).toBe("/logg-inn/2fa/oppsett");
      expect(mocks.setPendingTwoFactor).toHaveBeenCalledWith("u1");
    } finally {
      if (original === undefined) delete process.env.REQUIRE_2FA_ROLES;
      else process.env.REQUIRE_2FA_ROLES = original;
    }
  });

  it("returnerer en tydelig feilkode når koblingen avvises", async () => {
    mocks.resolveSsoUser.mockResolvedValue({
      ok: false,
      reason: "not_provisioned",
    });
    const result = await callSignIn({ provider: "sso-entra" });
    expect(result).toBe("/logg-inn?error=SsoNotProvisioned");
    expect(mocks.recordSsoLogin).not.toHaveBeenCalled();
  });

  it("avviser ukjent provider uten å slå opp bruker", async () => {
    const result = await callSignIn({ provider: "sso-ukjent" });
    expect(result).toBe("/logg-inn?error=SsoConfiguration");
    expect(mocks.resolveSsoUser).not.toHaveBeenCalled();
  });

  it("lar credentials-provideren gå videre til sine egne kontroller", async () => {
    const result = await callSignIn({ provider: "credentials" });
    expect(result).toBe(true);
    expect(mocks.resolveSsoUser).not.toHaveBeenCalled();
  });
});
