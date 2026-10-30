import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    skill: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    userSkill: {
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    workOrderSkill: { count: vi.fn() },
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    userAvailability: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    absence: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import {
  availableTechnicians,
  createAbsence,
  createSkill,
  deleteAbsence,
  deleteSkill,
  isAbsenceKind,
  isValidAbsencePeriod,
  isValidSkillKey,
  listAbsences,
  listSkills,
  listUserAvailability,
  listUserSkills,
  normalizeAvailabilityWindows,
  replaceUserAvailability,
  setUserSkills,
  updateAbsence,
  updateSkill,
} from "./workforce";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "actor",
    name: "Kari Kontor",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    contactId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: {
      permissions: [
        "users.view",
        "users.manage",
        "workorders.view",
        "workorders.assign",
      ],
    },
    ...overrides,
  };
}

const office = () => actor();
const admin = () => actor({ role: "ADMIN" });
const viewer = () =>
  actor({ roleDefinition: { permissions: ["users.view"] } });
const noAccess = () =>
  actor({ role: "USER", roleDefinition: { permissions: [] } });

function staff(overrides: Record<string, unknown> = {}) {
  return {
    id: "staff-1",
    name: "Ola Montør",
    departmentId: "dep-a",
    ...overrides,
  };
}

function skillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    key: "hms.sja",
    label: "SJA",
    category: "HMS",
    _count: { users: 0, workOrders: 0 },
    ...overrides,
  };
}

function userSkillRow(overrides: Record<string, unknown> = {}) {
  return {
    skillId: "skill-1",
    level: 3,
    validUntil: null,
    skill: { key: "hms.sja", label: "SJA", category: "HMS" },
    ...overrides,
  };
}

function absenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "absence-1",
    userId: "staff-1",
    startsAt: new Date("2026-11-02T07:00:00.000Z"),
    endsAt: new Date("2026-11-03T07:00:00.000Z"),
    kind: "FERIE",
    note: null,
    ...overrides,
  };
}

const osloMorning = new Date("2026-11-02T08:00:00.000Z"); // 09:00 i Oslo
const osloNoon = new Date("2026-11-02T11:00:00.000Z"); // 12:00 i Oslo

beforeEach(() => {
  vi.clearAllMocks();

  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );

  mocks.prisma.skill.findMany.mockResolvedValue([]);
  mocks.prisma.skill.findUnique.mockResolvedValue(null);
  mocks.prisma.skill.create.mockResolvedValue(skillRow());
  mocks.prisma.skill.update.mockResolvedValue(skillRow());
  mocks.prisma.skill.delete.mockResolvedValue(skillRow());
  mocks.prisma.userSkill.count.mockResolvedValue(0);
  mocks.prisma.userSkill.findMany.mockResolvedValue([]);
  mocks.prisma.userSkill.deleteMany.mockResolvedValue({ count: 0 });
  mocks.prisma.userSkill.upsert.mockResolvedValue({});
  mocks.prisma.workOrderSkill.count.mockResolvedValue(0);
  mocks.prisma.user.findFirst.mockResolvedValue(staff());
  mocks.prisma.user.findMany.mockResolvedValue([]);
  mocks.prisma.userAvailability.findMany.mockResolvedValue([]);
  mocks.prisma.userAvailability.deleteMany.mockResolvedValue({ count: 0 });
  mocks.prisma.userAvailability.createMany.mockResolvedValue({ count: 0 });
  mocks.prisma.absence.findMany.mockResolvedValue([]);
  mocks.prisma.absence.findUnique.mockResolvedValue(null);
  mocks.prisma.absence.findFirst.mockResolvedValue(null);
  mocks.prisma.absence.create.mockResolvedValue(absenceRow());
  mocks.prisma.absence.update.mockResolvedValue(absenceRow());
  mocks.prisma.absence.delete.mockResolvedValue(absenceRow());
  mocks.audit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Ren validering
// ---------------------------------------------------------------------------

describe("ren validering", () => {
  it("godtar bare stabile kompetansenøkler", () => {
    expect(isValidSkillKey("a1")).toBe(true);
    expect(isValidSkillKey("hms.sja")).toBe(true);
    expect(isValidSkillKey("a-b_c.d")).toBe(true);
    expect(isValidSkillKey("a".repeat(64))).toBe(true);

    expect(isValidSkillKey("a")).toBe(false);
    expect(isValidSkillKey("A1")).toBe(false);
    expect(isValidSkillKey("-a")).toBe(false);
    expect(isValidSkillKey("a b")).toBe(false);
    expect(isValidSkillKey("a".repeat(65))).toBe(false);
    expect(isValidSkillKey(null)).toBe(false);
  });

  it("sorterer arbeidstidsvinduer og avviser overlapp", () => {
    expect(
      normalizeAvailabilityWindows([
        { weekday: 2, startMinute: 480, endMinute: 720 },
        { weekday: 0, startMinute: 960, endMinute: 1200 },
        { weekday: 0, startMinute: 480, endMinute: 720 },
      ]),
    ).toEqual([
      { weekday: 0, startMinute: 480, endMinute: 720 },
      { weekday: 0, startMinute: 960, endMinute: 1200 },
      { weekday: 2, startMinute: 480, endMinute: 720 },
    ]);

    expect(
      normalizeAvailabilityWindows([
        { weekday: 0, startMinute: 480, endMinute: 720 },
        { weekday: 0, startMinute: 720, endMinute: 960 },
      ]),
    ).toHaveLength(2);

    expect(
      normalizeAvailabilityWindows([
        { weekday: 0, startMinute: 480, endMinute: 720 },
        { weekday: 0, startMinute: 719, endMinute: 960 },
      ]),
    ).toBeNull();
  });

  it("avviser ugyldige arbeidstidsvinduer og for mange rader", () => {
    expect(
      normalizeAvailabilityWindows([
        { weekday: 7, startMinute: 480, endMinute: 720 },
      ]),
    ).toBeNull();
    expect(
      normalizeAvailabilityWindows([
        { weekday: 0, startMinute: 720, endMinute: 720 },
      ]),
    ).toBeNull();
    expect(
      normalizeAvailabilityWindows([
        { weekday: 0, startMinute: 0, endMinute: 1441 },
      ]),
    ).toBeNull();
    expect(normalizeAvailabilityWindows(null)).toBeNull();

    const tooMany = Array.from({ length: 51 }, (_, index) => ({
      weekday: index % 7,
      startMinute: Math.floor(index / 7) * 10,
      endMinute: Math.floor(index / 7) * 10 + 5,
    }));
    expect(normalizeAvailabilityWindows(tooMany)).toBeNull();
  });

  it("validerer fraværslengde og type", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(
      isValidAbsencePeriod(start, new Date("2026-01-02T00:00:00.000Z")),
    ).toBe(true);
    expect(
      isValidAbsencePeriod(start, new Date("2027-01-01T00:00:00.000Z")),
    ).toBe(true);
    expect(
      isValidAbsencePeriod(start, new Date("2027-01-02T00:00:00.000Z")),
    ).toBe(false);
    expect(isValidAbsencePeriod(start, start)).toBe(false);
    expect(
      isValidAbsencePeriod(
        new Date("2026-01-02T00:00:00.000Z"),
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);

    expect(isAbsenceKind("FERIE")).toBe(true);
    expect(isAbsenceKind("SYKDOM")).toBe(true);
    expect(isAbsenceKind("KURS")).toBe(true);
    expect(isAbsenceKind("ANNET")).toBe(true);
    expect(isAbsenceKind("ferie")).toBe(false);
    expect(isAbsenceKind("MØTE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kompetansekatalog
// ---------------------------------------------------------------------------

describe("kompetansekatalogen", () => {
  it("krever users.view for å liste og users.manage for å endre", async () => {
    await expect(listSkills(noAccess())).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    expect(mocks.prisma.skill.findMany).not.toHaveBeenCalled();

    await expect(
      createSkill(noAccess(), { key: "hms.sja", label: "SJA" }),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.skill.create).not.toHaveBeenCalled();

    mocks.prisma.skill.findMany.mockResolvedValue([skillRow()]);
    const listed = await listSkills(viewer());
    expect(listed).toMatchObject({
      ok: true,
      data: [
        {
          id: "skill-1",
          key: "hms.sja",
          userCount: 0,
          workOrderCount: 0,
        },
      ],
    });
  });

  it("oppretter kompetanse og skriver revisjonslogg i transaksjonen", async () => {
    mocks.prisma.skill.create.mockResolvedValue(
      skillRow({ id: "skill-2", key: "lift", label: "Lift", category: null }),
    );

    const result = await createSkill(office(), {
      key: "lift",
      label: "  Lift  ",
      category: "",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.skill.create).toHaveBeenCalledWith({
      data: { key: "lift", label: "Lift", category: null },
      select: expect.any(Object),
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "Skill",
        entityId: "skill-2",
        action: "Opprettet kompetanse: Lift",
      }),
    );
  });

  it("avviser ugyldig nøkkel, etikett og kategori", async () => {
    await expect(
      createSkill(office(), { key: "HMS", label: "SJA" }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    await expect(
      createSkill(office(), { key: "hms.sja", label: "" }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    await expect(
      createSkill(office(), { key: "hms.sja", label: "x".repeat(81) }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    await expect(
      createSkill(office(), {
        key: "hms.sja",
        label: "SJA",
        category: "x".repeat(81),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });

    expect(mocks.prisma.skill.create).not.toHaveBeenCalled();
  });

  it("gir konflikt når nøkkelen allerede finnes", async () => {
    mocks.prisma.skill.create.mockRejectedValue(
      Object.assign(new Error("unik"), { code: "P2002" }),
    );

    await expect(
      createSkill(office(), { key: "hms.sja", label: "SJA" }),
    ).resolves.toMatchObject({ ok: false, reason: "conflict" });
  });

  it("oppdaterer kompetanse og beholder utelatte felter", async () => {
    mocks.prisma.skill.findUnique.mockResolvedValue({
      id: "skill-1",
      key: "hms.sja",
      label: "SJA",
      category: "HMS",
    });
    mocks.prisma.skill.update.mockResolvedValue(
      skillRow({
        key: "hms.sja",
        label: "Sikker jobbanalyse",
        category: "HMS",
      }),
    );

    const result = await updateSkill(office(), {
      id: "skill-1",
      label: "Sikker jobbanalyse",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.skill.update).toHaveBeenCalledWith({
      where: { id: "skill-1" },
      data: {
        key: "hms.sja",
        label: "Sikker jobbanalyse",
        category: "HMS",
      },
      select: expect.any(Object),
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        action: "Endret kompetanse: Sikker jobbanalyse",
      }),
    );
  });

  it("blokkerer sletting når kompetansen er i bruk", async () => {
    mocks.prisma.skill.findUnique.mockResolvedValue({
      id: "skill-1",
      key: "hms.sja",
      label: "SJA",
    });
    mocks.prisma.userSkill.count.mockResolvedValue(2);

    const result = await deleteSkill(office(), { id: "skill-1" });

    expect(result).toEqual({
      ok: false,
      reason: "in_use",
      details: { userCount: 2, workOrderCount: 0 },
    });
    expect(mocks.prisma.skill.delete).not.toHaveBeenCalled();
  });

  it("sletter ubrukt kompetanse og logger det", async () => {
    mocks.prisma.skill.findUnique.mockResolvedValue({
      id: "skill-1",
      key: "hms.sja",
      label: "SJA",
    });

    await expect(deleteSkill(office(), { id: "skill-1" })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.prisma.skill.delete).toHaveBeenCalledWith({
      where: { id: "skill-1" },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "Skill",
        action: "Slettet kompetanse: SJA",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Ansattes kompetanse
// ---------------------------------------------------------------------------

describe("ansattes kompetanse", () => {
  it("krever users.manage og avdelingsomfang", async () => {
    await expect(listUserSkills(viewer(), "staff-1")).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });

    mocks.prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      setUserSkills(office(), "staff-2", []),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });

    expect(mocks.prisma.user.findFirst).toHaveBeenLastCalledWith({
      where: {
        id: "staff-2",
        AND: expect.arrayContaining([
          expect.objectContaining({ departmentId: "dep-a" }),
        ]),
      },
      select: { id: true, name: true, departmentId: true },
    });
    expect(mocks.prisma.userSkill.upsert).not.toHaveBeenCalled();
  });

  it("lister kompetanse med nivå og gyldighetsdato", async () => {
    mocks.prisma.userSkill.findMany.mockResolvedValue([userSkillRow()]);

    const result = await listUserSkills(office(), "staff-1");

    expect(result).toMatchObject({
      ok: true,
      data: [
        {
          skillId: "skill-1",
          key: "hms.sja",
          label: "SJA",
          level: 3,
          validUntil: null,
        },
      ],
    });
    expect(mocks.prisma.userSkill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "staff-1" } }),
    );
  });

  it("erstatter kompetanselisten med upsert og fjerning", async () => {
    mocks.prisma.skill.findMany.mockResolvedValue([
      { id: "skill-1" },
      { id: "skill-2" },
    ]);
    mocks.prisma.userSkill.findMany.mockResolvedValue([
      userSkillRow(),
      userSkillRow({
        skillId: "skill-2",
        level: 5,
        skill: { key: "lift", label: "Lift", category: null },
      }),
    ]);

    const result = await setUserSkills(office(), "staff-1", [
      { skillId: "skill-1", level: "3", validUntil: "2027-12-31" },
      { skillId: "skill-2", level: 5 },
    ]);

    expect(result.ok).toBe(true);
    expect(mocks.prisma.userSkill.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "staff-1",
        skillId: { notIn: ["skill-1", "skill-2"] },
      },
    });
    expect(mocks.prisma.userSkill.upsert).toHaveBeenNthCalledWith(1, {
      where: {
        userId_skillId: { userId: "staff-1", skillId: "skill-1" },
      },
      create: {
        userId: "staff-1",
        skillId: "skill-1",
        level: 3,
        validUntil: new Date("2027-12-31T00:00:00.000Z"),
      },
      update: {
        level: 3,
        validUntil: new Date("2027-12-31T00:00:00.000Z"),
      },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "User",
        entityId: "staff-1",
        action: "Oppdaterte kompetanse for Ola Montør",
      }),
    );
  });

  it("avviser ugyldig nivå, dato og ukjent kompetanse", async () => {
    await expect(
      setUserSkills(office(), "staff-1", [{ skillId: "skill-1", level: 6 }]),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    await expect(
      setUserSkills(office(), "staff-1", [
        { skillId: "skill-1", validUntil: "ikke-en-dato" },
      ]),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    await expect(
      setUserSkills(office(), "staff-1", [
        { skillId: "skill-1", validUntil: "2026-02-30" },
      ]),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });

    mocks.prisma.skill.findMany.mockResolvedValue([]);
    const unknown = await setUserSkills(office(), "staff-1", [
      { skillId: "skill-9" },
    ]);
    expect(unknown).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.prisma.userSkill.upsert).not.toHaveBeenCalled();
  });

  it("lar administrator styre ansatte i alle avdelinger", async () => {
    mocks.prisma.user.findFirst.mockResolvedValue(
      staff({ id: "staff-2", departmentId: "dep-b" }),
    );

    await expect(listUserSkills(admin(), "staff-2")).resolves.toMatchObject({
      ok: true,
    });
    expect(mocks.prisma.user.findFirst).toHaveBeenCalledWith({
      where: expect.not.objectContaining({ departmentId: "dep-a" }),
      select: { id: true, name: true, departmentId: true },
    });
  });
});

// ---------------------------------------------------------------------------
// Ukentlig arbeidstid
// ---------------------------------------------------------------------------

describe("ukentlig arbeidstid", () => {
  it("krever users.manage og avdelingsomfang", async () => {
    await expect(
      listUserAvailability(viewer(), "staff-1"),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });

    mocks.prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      replaceUserAvailability(office(), "staff-9", []),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.userAvailability.deleteMany).not.toHaveBeenCalled();
  });

  it("erstatter arbeidstiden i én transaksjon", async () => {
    mocks.prisma.userAvailability.findMany.mockResolvedValue([
      { id: "av-1", weekday: 0, startMinute: 480, endMinute: 960 },
    ]);

    const result = await replaceUserAvailability(office(), "staff-1", [
      { weekday: 0, startMinute: 480, endMinute: 960 },
    ]);

    expect(result).toMatchObject({
      ok: true,
      data: [{ id: "av-1", weekday: 0, startMinute: 480, endMinute: 960 }],
    });
    expect(mocks.prisma.userAvailability.deleteMany).toHaveBeenCalledWith({
      where: { userId: "staff-1" },
    });
    expect(mocks.prisma.userAvailability.createMany).toHaveBeenCalledWith({
      data: [{ userId: "staff-1", weekday: 0, startMinute: 480, endMinute: 960 }],
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "User",
        entityId: "staff-1",
        action: "Endret arbeidstid for Ola Montør",
      }),
    );
  });

  it("avviser overlappende vinduer uten å røre databasen", async () => {
    const result = await replaceUserAvailability(office(), "staff-1", [
      { weekday: 0, startMinute: 480, endMinute: 720 },
      { weekday: 0, startMinute: 660, endMinute: 960 },
    ]);

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.userAvailability.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.userAvailability.createMany).not.toHaveBeenCalled();
  });

  it("tillater at en ansatt tømmer arbeidstiden", async () => {
    await replaceUserAvailability(office(), "staff-1", []);

    expect(mocks.prisma.userAvailability.deleteMany).toHaveBeenCalledWith({
      where: { userId: "staff-1" },
    });
    expect(mocks.prisma.userAvailability.createMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fravær
// ---------------------------------------------------------------------------

describe("fravær", () => {
  it("krever users.manage og avdelingsomfang", async () => {
    await expect(listAbsences(viewer(), "staff-1")).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });

    mocks.prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      createAbsence(office(), {
        userId: "staff-9",
        startsAt: "2026-11-02T08:00",
        endsAt: "2026-11-03T16:00",
        kind: "FERIE",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.absence.create).not.toHaveBeenCalled();
  });

  it("registrerer fravær og tolker lokal tid som Oslo-tid", async () => {
    const result = await createAbsence(office(), {
      userId: "staff-1",
      startsAt: "2026-11-02T08:00",
      endsAt: "2026-11-02T16:00",
      kind: "FERIE",
      note: "  Høstferie  ",
    });

    expect(result.ok).toBe(true);
    const createCall = mocks.prisma.absence.create.mock.calls[0][0];
    expect(createCall.data.startsAt.toISOString()).toBe(
      "2026-11-02T07:00:00.000Z",
    );
    expect(createCall.data.endsAt.toISOString()).toBe(
      "2026-11-02T15:00:00.000Z",
    );
    expect(createCall.data).toMatchObject({
      userId: "staff-1",
      kind: "FERIE",
      note: "Høstferie",
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        entityType: "User",
        entityId: "staff-1",
        action: "Registrerte fravær for Ola Montør",
      }),
    );
  });

  it("avviser for lange perioder, ugyldig type og for lang notat", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const tooLong = new Date("2027-01-02T00:00:00.000Z");

    await expect(
      createAbsence(office(), {
        userId: "staff-1",
        startsAt: start,
        endsAt: tooLong,
        kind: "FERIE",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });

    await expect(
      createAbsence(office(), {
        userId: "staff-1",
        startsAt: start,
        endsAt: new Date("2026-01-02T00:00:00.000Z"),
        kind: "MØTE",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });

    await expect(
      createAbsence(office(), {
        userId: "staff-1",
        startsAt: start,
        endsAt: new Date("2026-01-02T00:00:00.000Z"),
        kind: "ANNET",
        note: "x".repeat(501),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });

    expect(mocks.prisma.absence.create).not.toHaveBeenCalled();
  });

  it("avviser nøyaktig duplikat", async () => {
    mocks.prisma.absence.findFirst.mockResolvedValue({ id: "absence-1" });

    await expect(
      createAbsence(office(), {
        userId: "staff-1",
        startsAt: "2026-11-02T08:00",
        endsAt: "2026-11-02T16:00",
        kind: "FERIE",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "conflict" });
    expect(mocks.prisma.absence.create).not.toHaveBeenCalled();
  });

  it("oppdaterer fravær og beholder utelatte felter", async () => {
    mocks.prisma.absence.findUnique.mockResolvedValue(absenceRow());

    const result = await updateAbsence(office(), {
      id: "absence-1",
      kind: "SYKDOM",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.absence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "absence-1" },
        data: expect.objectContaining({
          kind: "SYKDOM",
          startsAt: new Date("2026-11-02T07:00:00.000Z"),
          endsAt: new Date("2026-11-03T07:00:00.000Z"),
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({ action: "Endret fravær for Ola Montør" }),
    );
  });

  it("sletter fravær etter omfangssjekk", async () => {
    mocks.prisma.absence.findUnique.mockResolvedValue({
      id: "absence-1",
      userId: "staff-1",
    });

    await expect(
      deleteAbsence(office(), { id: "absence-1" }),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(mocks.prisma.absence.delete).toHaveBeenCalledWith({
      where: { id: "absence-1" },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({ action: "Slettet fravær for Ola Montør" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tilgjengelige teknikere
// ---------------------------------------------------------------------------

describe("availableTechnicians", () => {
  const range = { startsAt: osloMorning, endsAt: osloNoon };

  it("krever lesetilgang og et gyldig intervall", async () => {
    await expect(
      availableTechnicians(noAccess(), range),
    ).resolves.toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled();

    await expect(
      availableTechnicians(office(), {
        startsAt: osloNoon,
        endsAt: osloMorning,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("avgrenser til 200 og ekskluderer fravær og overlappende visitter", async () => {
    await availableTechnicians(office(), range);

    const query = mocks.prisma.user.findMany.mock.calls[0][0];
    expect(query.take).toBe(200);
    expect(query.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ departmentId: "dep-a" }),
          ]),
        }),
        expect.objectContaining({
          absences: {
            none: {
              startsAt: { lt: range.endsAt },
              endsAt: { gt: range.startsAt },
            },
          },
        }),
        expect.objectContaining({
          visitAssignments: {
            none: {
              visit: expect.objectContaining({
                status: { not: "CANCELLED" },
                startsAt: { lt: range.endsAt },
                endsAt: { gt: range.startsAt },
              }),
            },
          },
        }),
      ]),
    );
  });

  it("krever alle oppgitte kompetansenøkler", async () => {
    await availableTechnicians(office(), range, {
      skillKeys: ["hms.sja", "lift"],
    });

    const query = mocks.prisma.user.findMany.mock.calls[0][0];
    const skillFilters = query.where.AND.filter(
      (entry: Record<string, unknown>) => "skills" in entry,
    );
    expect(skillFilters).toHaveLength(2);
    expect(skillFilters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skills: {
            some: expect.objectContaining({ skill: { key: "hms.sja" } }),
          },
        }),
        expect.objectContaining({
          skills: {
            some: expect.objectContaining({ skill: { key: "lift" } }),
          },
        }),
      ]),
    );
  });

  it("bruker første Oslo-dag og markerer manglende arbeidstid", async () => {
    mocks.prisma.user.findMany.mockResolvedValue([
      {
        id: "tech-available",
        name: "Anna",
        departmentId: "dep-a",
        availability: [{ weekday: 0, startMinute: 480, endMinute: 960 }],
        skills: [
          {
            level: 4,
            validUntil: null,
            skill: { key: "hms.sja", label: "SJA", category: "HMS" },
          },
        ],
      },
      {
        id: "tech-unconfigured",
        name: "Bo",
        departmentId: "dep-a",
        availability: [],
        skills: [],
      },
      {
        id: "tech-unavailable",
        name: "Cato",
        departmentId: "dep-a",
        availability: [{ weekday: 0, startMinute: 600, endMinute: 960 }],
        skills: [],
      },
      {
        id: "tech-wrong-day",
        name: "Dina",
        departmentId: "dep-a",
        availability: [{ weekday: 1, startMinute: 480, endMinute: 960 }],
        skills: [],
      },
    ]);

    const result = await availableTechnicians(office(), range);

    expect(result).toMatchObject({
      ok: true,
      data: [
        {
          id: "tech-available",
          availability: "available",
          skills: [{ key: "hms.sja", level: 4 }],
        },
        { id: "tech-unconfigured", availability: "unconfigured" },
      ],
    });
  });

  it("utelater ukonfigurerte teknikere når requiredOnly er satt", async () => {
    mocks.prisma.user.findMany.mockResolvedValue([
      {
        id: "tech-available",
        name: "Anna",
        departmentId: "dep-a",
        availability: [{ weekday: 0, startMinute: 480, endMinute: 960 }],
        skills: [],
      },
      {
        id: "tech-unconfigured",
        name: "Bo",
        departmentId: "dep-a",
        availability: [],
        skills: [],
      },
    ]);

    const result = await availableTechnicians(office(), range, {
      requiredOnly: true,
    });

    expect(result).toMatchObject({
      ok: true,
      data: [{ id: "tech-available" }],
    });
  });
});
