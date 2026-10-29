import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  allowRequestDb: vi.fn(),
  resetRateLimitDb: vi.fn(),
  compare: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
  resetRateLimitDb: mocks.resetRateLimitDb,
}));
vi.mock("bcryptjs", () => ({
  default: { compare: mocks.compare },
}));

import { verifyCredentials } from "./credentials";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.resetRateLimitDb.mockResolvedValue(undefined);
  mocks.compare.mockResolvedValue(true);
  mocks.findUnique.mockResolvedValue({
    id: "u1",
    email: "kari@firma.no",
    name: "Kari",
    role: "OFFICE",
    password: "hash",
    isActive: true,
    isTwoFactorEnabled: false,
    sessionVersion: 0,
  });
});

/** Teller som oppfører seg som databasen: over grensen gir «locked». */
function countingLimiter() {
  const counts = new Map<string, number>();
  mocks.allowRequestDb.mockImplementation(
    async (key: string, limit: number) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count <= limit
        ? { allowed: true, retryAfterSeconds: 0 }
        : { allowed: false, retryAfterSeconds: 600 };
    },
  );
  return counts;
}

describe("verifyCredentials – e-postnormalisering", () => {
  it("slår opp en e-post med store bokstaver og mellomrom i små bokstaver", async () => {
    const result = await verifyCredentials("  Kari@Firma.NO ", "riktig");

    expect(result.status).toBe("ok");
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { email: "kari@firma.no" },
    });
    expect(mocks.resetRateLimitDb).toHaveBeenCalledWith("email:kari@firma.no");
  });

  it("avviser ugyldig e-post uten å slå opp i databasen", async () => {
    const result = await verifyCredentials("ikke-en-epost", "riktig");

    expect(result).toEqual({ status: "invalid" });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});

describe("verifyCredentials – sperre gjelder bare feil passord", () => {
  it("slipper riktig passord gjennom selv om e-posttelleren er sperret", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 900,
    });

    const result = await verifyCredentials("kari@firma.no", "riktig");

    expect(result.status).toBe("ok");
    // Riktig passord skal aldri avvises av telleren, så den leses ikke i det
    // hele tatt før legitimasjonen er verifisert.
    expect(mocks.allowRequestDb).not.toHaveBeenCalled();
  });

  it("lar riktig passord passere etter ti feilede forsøk", async () => {
    countingLimiter();
    mocks.compare.mockResolvedValue(false);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await verifyCredentials("kari@firma.no", "feil");
      expect(result).toEqual({ status: "invalid" });
    }

    mocks.compare.mockResolvedValue(true);
    const result = await verifyCredentials("kari@firma.no", "riktig");

    expect(result.status).toBe("ok");
    expect(mocks.resetRateLimitDb).toHaveBeenCalledWith("email:kari@firma.no");
  });

  it("sperrer videre feil passord etter ti forsøk", async () => {
    countingLimiter();
    mocks.compare.mockResolvedValue(false);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await verifyCredentials("kari@firma.no", "feil");
      expect(result).toEqual({ status: "invalid" });
    }

    const result = await verifyCredentials("kari@firma.no", "feil");

    expect(result).toEqual({ status: "locked", retryAfterSeconds: 600 });
  });

  it("teller både konto og IP ved feil passord", async () => {
    mocks.compare.mockResolvedValue(false);

    const result = await verifyCredentials("kari@firma.no", "feil", "1.2.3.4");

    expect(result).toEqual({ status: "invalid" });
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "email:kari@firma.no",
      expect.any(Number),
      expect.any(Number),
    );
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "ip:1.2.3.4",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("bruker ingen felles IP-nøkkel når klient-IP er ukjent", async () => {
    mocks.compare.mockResolvedValue(false);

    const result = await verifyCredentials("kari@firma.no", "feil");

    expect(result).toEqual({ status: "invalid" });
    expect(mocks.allowRequestDb).toHaveBeenCalledTimes(1);
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "email:kari@firma.no",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("nullstiller kontoen, men ikke den delte IP-telleren, ved vellykket innlogging", async () => {
    const result = await verifyCredentials("kari@firma.no", "riktig", "1.2.3.4");

    expect(result.status).toBe("ok");
    expect(mocks.resetRateLimitDb).toHaveBeenCalledWith("email:kari@firma.no");
    expect(mocks.resetRateLimitDb).not.toHaveBeenCalledWith("ip:1.2.3.4");
  });

  it("gjør bcrypt-arbeid også når e-posten ikke finnes", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.compare.mockResolvedValue(false);

    const result = await verifyCredentials("ukjent@firma.no", "feil");

    expect(result).toEqual({ status: "invalid" });
    expect(mocks.compare).toHaveBeenCalledWith("feil", expect.any(String));
  });

  it("avviser riktig passord for en inaktiv konto uten å nullstille telleren", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "u1",
      email: "kari@firma.no",
      name: "Kari",
      role: "OFFICE",
      password: "hash",
      isActive: false,
      isTwoFactorEnabled: false,
      sessionVersion: 0,
    });

    const result = await verifyCredentials("kari@firma.no", "riktig");

    expect(result).toEqual({ status: "inactive" });
    expect(mocks.resetRateLimitDb).not.toHaveBeenCalled();
  });
});
