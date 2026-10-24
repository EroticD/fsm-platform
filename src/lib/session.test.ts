import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth-options", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { bumpSessionVersion, getCurrentUser } from "./session";

const mockedSession = vi.mocked(getServerSession);
const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedUpdate = vi.mocked(prisma.user.update);

describe("getCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returnerer brukeren når økten og versjonen stemmer", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1", sessionVersion: 2 } } as never);
    mockedFindUnique.mockResolvedValue({
      id: "u1",
      isActive: true,
      sessionVersion: 2,
      department: null,
      roleDefinition: null,
    } as never);

    const user = await getCurrentUser();
    expect(user?.id).toBe("u1");
    expect(mockedFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } }),
    );
  });

  it("returnerer null for inaktive brukere", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1", sessionVersion: 0 } } as never);
    mockedFindUnique.mockResolvedValue({
      id: "u1",
      isActive: false,
      sessionVersion: 0,
    } as never);

    expect(await getCurrentUser()).toBeNull();
  });

  it("returnerer null når øktversjonen er utdatert", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1", sessionVersion: 1 } } as never);
    mockedFindUnique.mockResolvedValue({
      id: "u1",
      isActive: true,
      sessionVersion: 2,
    } as never);

    expect(await getCurrentUser()).toBeNull();
  });

  it("returnerer null uten gyldig økt", async () => {
    mockedSession.mockResolvedValue(null as never);
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("bumpSessionVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("øker versjonen med én og returnerer den nye verdien", async () => {
    mockedUpdate.mockResolvedValue({ sessionVersion: 4 } as never);
    const version = await bumpSessionVersion("u1");

    expect(version).toBe(4);
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
  });
});
