import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import {
  clearRecoveryCodesForDisplay,
  isSecureUrl,
  PENDING_2FA_MAX_AGE,
  readRecoveryCodesForDisplay,
  RECOVERY_CODES_COOKIE,
} from "./session-token";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.cookies.has(name)
        ? { name, value: state.cookies.get(name) }
        : undefined,
    set: (name: string, value: string) => {
      state.cookies.set(name, value);
    },
    delete: (name: string) => {
      state.cookies.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

const SECRET = "test-secret";

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
  state.cookies.clear();
});

afterEach(() => {
  delete process.env.NEXTAUTH_SECRET;
});

async function displayToken(
  userId: string,
  codes: string[],
  expires: number,
): Promise<string> {
  return encode({
    token: { userId, codes, expires },
    secret: SECRET,
  });
}

describe("PENDING_2FA_MAX_AGE", () => {
  it("gir brukeren 15 minutter på 2FA-steget", () => {
    expect(PENDING_2FA_MAX_AGE).toBe(15 * 60);
  });
});

describe("isSecureUrl", () => {
  it("gjenkjenner https og http", () => {
    expect(isSecureUrl("https://fsm.example")).toBe(true);
    expect(isSecureUrl("http://fsm.example")).toBe(false);
  });

  it("returnerer null for manglende eller ugyldig URL", () => {
    expect(isSecureUrl(undefined)).toBeNull();
    expect(isSecureUrl("ikke-en-url")).toBeNull();
  });
});

describe("readRecoveryCodesForDisplay", () => {
  it("viser kodene for samme bruker", async () => {
    state.cookies.set(
      RECOVERY_CODES_COOKIE,
      await displayToken("user-1", ["AAAA-BBBB"], Date.now() + 60_000),
    );

    await expect(readRecoveryCodesForDisplay("user-1")).resolves.toEqual([
      "AAAA-BBBB",
    ]);
  });

  it("avviser en cookie som er laget for en annen bruker", async () => {
    state.cookies.set(
      RECOVERY_CODES_COOKIE,
      await displayToken("user-2", ["AAAA-BBBB"], Date.now() + 60_000),
    );

    await expect(readRecoveryCodesForDisplay("user-1")).resolves.toBeNull();
  });

  it("avviser utløpte koder og koder uten brukerbinding", async () => {
    state.cookies.set(
      RECOVERY_CODES_COOKIE,
      await displayToken("user-1", ["AAAA-BBBB"], Date.now() - 1_000),
    );
    await expect(readRecoveryCodesForDisplay("user-1")).resolves.toBeNull();

    state.cookies.set(
      RECOVERY_CODES_COOKIE,
      await encode({
        token: { codes: ["AAAA-BBBB"], expires: Date.now() + 60_000 },
        secret: SECRET,
      }),
    );
    await expect(readRecoveryCodesForDisplay("user-1")).resolves.toBeNull();
  });

  it("sletter visningscookien", async () => {
    state.cookies.set(RECOVERY_CODES_COOKIE, "token");

    await clearRecoveryCodesForDisplay();

    expect(state.cookies.has(RECOVERY_CODES_COOKIE)).toBe(false);
  });
});
