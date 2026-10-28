import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  userId: string;
  codeHash: string;
  usedAt: Date | null;
};

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  prisma: {
    twoFactorRecoveryCode: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import {
  consumeRecoveryCode,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  replaceRecoveryCodes,
  verifyRecoveryCodeHash,
} from "./two-factor-recovery";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.length = 0;

  mocks.prisma.twoFactorRecoveryCode.findMany.mockImplementation(
    async (args: { where: { userId: string; usedAt?: null } }) =>
      mocks.rows
        .filter(
          (row) =>
            row.userId === args.where.userId &&
            (args.where.usedAt !== null || row.usedAt === null),
        )
        .map((row) => ({ id: row.id, codeHash: row.codeHash })),
  );

  mocks.prisma.twoFactorRecoveryCode.updateMany.mockImplementation(
    async (args: {
      where: { id: string; userId: string; usedAt?: null };
      data: { usedAt: Date };
    }) => {
      const row = mocks.rows.find(
        (candidate) =>
          candidate.id === args.where.id &&
          candidate.userId === args.where.userId &&
          (args.where.usedAt !== null || candidate.usedAt === null),
      );
      if (!row) return { count: 0 };
      row.usedAt = args.data.usedAt;
      return { count: 1 };
    },
  );
});

describe("gjenopprettingskoder – generering", () => {
  it("lager ti unike koder på formen XXXX-XXXX", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("normaliserer inntasting og avviser ugyldige tegn", () => {
    const code = generateRecoveryCode();
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(code);
    expect(normalizeRecoveryCode(code.replace("-", " "))).toBe(code);
    expect(normalizeRecoveryCode("IIII-IIII")).toBeNull();
    expect(normalizeRecoveryCode("0000-0000")).toBeNull();
    expect(normalizeRecoveryCode("for kort")).toBeNull();
  });
});

describe("gjenopprettingskoder – hashing", () => {
  it("lagrer bare hash og godtar riktig kode", async () => {
    const code = generateRecoveryCode();
    const hash = await hashRecoveryCode(code, 4);

    expect(hash).not.toContain(code);
    await expect(verifyRecoveryCodeHash(code, hash)).resolves.toBe(true);
    await expect(
      verifyRecoveryCodeHash(code.toLowerCase(), hash),
    ).resolves.toBe(true);
  });

  it("avviser feil og ugyldig kode", async () => {
    const code = generateRecoveryCode();
    const hash = await hashRecoveryCode(code, 4);

    await expect(verifyRecoveryCodeHash("AAAA-AAAA", hash)).resolves.toBe(
      false,
    );
    await expect(verifyRecoveryCodeHash(" ikke en kode ", hash)).resolves.toBe(
      false,
    );
  });
});

describe("gjenopprettingskoder – lagring og engangsbruk", () => {
  it("erstatter gamle koder og lagrer bare hasher", async () => {
    const writer = {
      twoFactorRecoveryCode: {
        deleteMany: vi.fn(async (_args: { where: { userId: string } }) => ({
          count: 1,
        })),
        createMany: vi.fn(
          async (_args: {
            data: Array<{ userId: string; codeHash: string }>;
          }) => ({ count: 10 }),
        ),
      },
    };

    const codes = await replaceRecoveryCodes(
      writer as unknown as Parameters<typeof replaceRecoveryCodes>[0],
      "user-1",
    );

    expect(writer.twoFactorRecoveryCode.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    const created = writer.twoFactorRecoveryCode.createMany.mock.calls[0][0];
    expect(created.data).toHaveLength(10);
    for (const [index, row] of created.data.entries()) {
      expect(row.userId).toBe("user-1");
      expect(row.codeHash).not.toBe(codes[index]);
      await expect(
        verifyRecoveryCodeHash(codes[index], row.codeHash),
      ).resolves.toBe(true);
    }
  });

  it("bruker en kode bare én gang og avviser feil kode", async () => {
    const code = generateRecoveryCode();
    mocks.rows.push({
      id: "code-1",
      userId: "user-1",
      codeHash: await hashRecoveryCode(code, 4),
      usedAt: null,
    });

    await expect(consumeRecoveryCode("user-1", "AAAA-AAAA")).resolves.toBe(
      false,
    );
    expect(mocks.prisma.twoFactorRecoveryCode.updateMany).not.toHaveBeenCalled();

    await expect(
      consumeRecoveryCode("user-1", code.toLowerCase()),
    ).resolves.toBe(true);
    expect(mocks.rows[0].usedAt).toBeInstanceOf(Date);

    await expect(consumeRecoveryCode("user-1", code)).resolves.toBe(false);
    expect(mocks.prisma.twoFactorRecoveryCode.updateMany).toHaveBeenCalledTimes(
      1,
    );
  });
});
