// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data og
// oversettes ved visning i audit-actions.ts.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { osloDayStart, parseDateOnly } from "@/lib/dates";
import { cleanText } from "@/lib/sanitize";
import {
  can,
  fail,
  ok,
  staffScopeFor,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/**
 * Tjenestelaget for arbeidsstyrken: kompetanse, arbeidstid og fravær.
 *
 * Alt her er knyttet til ansatte, ikke kundeportalbrukere. Lesing av
 * kompetansekatalogen krever `users.view`; alle endringer og all lesing av
 * den enkelte ansattes kompetanse, arbeidstid og fravær krever `users.manage`.
 * Målbrukeren må alltid ligge innenfor `staffScopeFor(actor)`, slik at en
 * avdelingsansvarlig ikke kan se eller endre ansatte i en annen avdeling.
 *
 * Revisjonsloggen bruker `entityType: "User"` for alt som gjelder en ansatt,
 * og `"Skill"` for selve kompetansekatalogen. Handlingsstrengene er stabile
 * norske tekster som oversettes ved visning i `src/lib/audit-actions.ts`.
 */

const MAX_SKILLS = 500;
const MAX_USER_SKILLS = 100;
const MAX_AVAILABILITY_WINDOWS = 50;
const MAX_ABSENCES = 200;
const MAX_TECHNICIANS = 200;
const MAX_ABSENCE_NOTE = 500;

/** 365 døgn, med én times slakk for overgangen til/fra sommertid. */
const MAX_ABSENCE_MS = 365 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000;

const SKILL_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export const ABSENCE_KINDS = ["FERIE", "SYKDOM", "KURS", "ANNET"] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

// ---------------------------------------------------------------------------
// Kompetansekatalog
// ---------------------------------------------------------------------------

export type SkillSummary = {
  id: string;
  key: string;
  label: string;
  category: string | null;
  /** Antall ansatte som er tildelt kompetansen. */
  userCount: number;
  /** Antall oppdrag som krever kompetansen. */
  workOrderCount: number;
};

export type SkillInput = {
  key?: unknown;
  label?: unknown;
  category?: unknown;
};

type SkillRow = {
  id: string;
  key: string;
  label: string;
  category: string | null;
  _count?: { users?: number; workOrders?: number } | null;
};

function toSkillSummary(row: SkillRow): SkillSummary {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    category: row.category,
    userCount: row._count?.users ?? 0,
    workOrderCount: row._count?.workOrders ?? 0,
  };
}

/** Kompetansenøkkelen er stabil og brukes i API-er og importfiler. */
export function isValidSkillKey(value: unknown): value is string {
  return typeof value === "string" && SKILL_KEY_PATTERN.test(value);
}

function rawText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validerer og normaliserer feltene for en kompetanse. Ved oppdatering kan
 * felter utelates, og da beholder vi den lagrede verdien. `category` kan
 * tømmes ved å sende null eller tom streng.
 */
function normalizeSkillInput(
  input: SkillInput,
  existing?: { key: string; label: string; category: string | null },
): { key: string; label: string; category: string | null } | null {
  const key =
    input.key === undefined && existing ? existing.key : rawText(input.key);
  if (!isValidSkillKey(key)) return null;

  const label =
    input.label === undefined && existing
      ? existing.label
      : rawText(input.label);
  if (!label || label.length > 80) return null;

  let category: string | null;
  if (input.category === undefined && existing) {
    category = existing.category;
  } else {
    const rawCategory =
      input.category === null ? "" : rawText(input.category);
    if (!rawCategory) {
      category = null;
    } else {
      if (rawCategory.length > 80) return null;
      category = cleanText(rawCategory, { maxLength: 80 }) || null;
    }
  }

  const cleanedLabel = cleanText(label, { maxLength: 80 });
  if (!cleanedLabel) return null;

  return {
    key,
    label: cleanedLabel,
    category,
  };
}

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function normalizeId(value: unknown): string | null {
  const id = cleanText(value, { maxLength: 200 });
  return id || null;
}

const skillSelect = {
  id: true,
  key: true,
  label: true,
  category: true,
  _count: { select: { users: true, workOrders: true } },
} satisfies Prisma.SkillSelect;

export async function listSkills(
  actor: ServiceActor,
): Promise<ServiceResult<SkillSummary[]>> {
  if (!can(actor, "users.view")) return fail("forbidden");

  const rows = await prisma.skill.findMany({
    orderBy: [{ category: "asc" }, { label: "asc" }],
    take: MAX_SKILLS,
    select: skillSelect,
  });
  return ok(rows.map(toSkillSummary));
}

export async function createSkill(
  actor: ServiceActor,
  input: SkillInput,
): Promise<ServiceResult<SkillSummary>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const normalized = normalizeSkillInput(input);
  if (!normalized) return fail("invalid");

  let created: SkillRow;
  try {
    created = await prisma.$transaction(async (tx) => {
      const skill = await tx.skill.create({
        data: normalized,
        select: skillSelect,
      });
      await audit(tx, {
        entityType: "Skill",
        entityId: skill.id,
        action: `Opprettet kompetanse: ${skill.label}`,
        actor: toAuditActor(actor),
      });
      return skill;
    });
  } catch (error) {
    if (uniqueViolation(error)) return fail("conflict");
    throw error;
  }

  return ok(toSkillSummary(created));
}

export async function updateSkill(
  actor: ServiceActor,
  input: SkillInput & { id?: unknown },
): Promise<ServiceResult<SkillSummary>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const id = normalizeId(input.id);
  if (!id) return fail("invalid");

  const existing = await prisma.skill.findUnique({
    where: { id },
    select: { id: true, key: true, label: true, category: true },
  });
  if (!existing) return fail("not_found");

  const normalized = normalizeSkillInput(input, existing);
  if (!normalized) return fail("invalid");

  let updated: SkillRow;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const skill = await tx.skill.update({
        where: { id: existing.id },
        data: normalized,
        select: skillSelect,
      });
      await audit(tx, {
        entityType: "Skill",
        entityId: skill.id,
        action: `Endret kompetanse: ${skill.label}`,
        actor: toAuditActor(actor),
      });
      return skill;
    });
  } catch (error) {
    if (uniqueViolation(error)) return fail("conflict");
    throw error;
  }

  return ok(toSkillSummary(updated));
}

/**
 * Sletter en kompetanse. Sletting blokkeres hvis kompetansen er tildelt en
 * ansatt eller kreves av et oppdrag, slik at historikk og krav ikke mister
 * betydningen sin. Da må den først fjernes der den er i bruk.
 */
export async function deleteSkill(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const id = normalizeId(input.id);
  if (!id) return fail("invalid");

  const existing = await prisma.skill.findUnique({
    where: { id },
    select: { id: true, key: true, label: true },
  });
  if (!existing) return fail("not_found");

  const [userCount, workOrderCount] = await Promise.all([
    prisma.userSkill.count({ where: { skillId: id } }),
    prisma.workOrderSkill.count({ where: { skillId: id } }),
  ]);
  if (userCount > 0 || workOrderCount > 0) {
    return fail("in_use", { userCount, workOrderCount });
  }

  await prisma.$transaction(async (tx) => {
    await tx.skill.delete({ where: { id: existing.id } });
    await audit(tx, {
      entityType: "Skill",
      entityId: existing.id,
      action: `Slettet kompetanse: ${existing.label}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Ansattes kompetanse
// ---------------------------------------------------------------------------

export type UserSkillSummary = {
  skillId: string;
  key: string;
  label: string;
  category: string | null;
  level: number | null;
  validUntil: Date | null;
};

export type UserSkillInput = {
  skillId?: unknown;
  level?: unknown;
  validUntil?: unknown;
};

type UserSkillRow = {
  skillId: string;
  level: number | null;
  validUntil: Date | null;
  skill: { key: string; label: string; category: string | null };
};

function toUserSkillSummary(row: UserSkillRow): UserSkillSummary {
  return {
    skillId: row.skillId,
    key: row.skill.key,
    label: row.skill.label,
    category: row.skill.category,
    level: row.level,
    validUntil: row.validUntil,
  };
}

/**
 * Slår opp en ansatt innenfor aktørens omfang. En bruker utenfor omfanget
 * behandles som `forbidden` – ikke `not_found` – fordi det er en
 * autorisasjonsfeil, ikke en manglende rad.
 */
async function findScopedStaff(
  actor: ServiceActor,
  rawId: unknown,
): Promise<{ id: string; name: string | null; departmentId: string | null } | null> {
  const id = normalizeId(rawId);
  if (!id) return null;

  return prisma.user.findFirst({
    where: { id, ...staffScopeFor(actor) },
    select: { id: true, name: true, departmentId: true },
  });
}

function parseValidUntil(
  value: unknown,
): { ok: true; value: Date | null } | { ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text && /^\d{4}-\d{2}-\d{2}$/.test(text) && !isCalendarDate(text)) {
    return { ok: false };
  }
  const date =
    text && /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? parseDateOnly(text)
      : toDate(value);
  return date ? { ok: true, value: date } : { ok: false };
}

function parseLevel(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const level = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return { ok: false };
  }
  return { ok: true, value: level };
}

type NormalizedUserSkill = {
  skillId: string;
  level: number | null;
  validUntil: Date | null;
};

function normalizeUserSkills(
  inputs: unknown,
): NormalizedUserSkill[] | null {
  if (!Array.isArray(inputs)) return null;
  if (inputs.length > MAX_USER_SKILLS) return null;

  const bySkill = new Map<string, NormalizedUserSkill>();
  for (const raw of inputs) {
    if (!raw || typeof raw !== "object") return null;
    const input = raw as UserSkillInput;
    const skillId = normalizeId(input.skillId);
    if (!skillId) return null;

    const level = parseLevel(input.level);
    if (!level.ok) return null;
    const validUntil = parseValidUntil(input.validUntil);
    if (!validUntil.ok) return null;

    // Siste forekomst vinner hvis samme kompetanse sendes flere ganger.
    bySkill.set(skillId, {
      skillId,
      level: level.value,
      validUntil: validUntil.value,
    });
  }
  return [...bySkill.values()];
}

async function readUserSkills(userId: string): Promise<UserSkillSummary[]> {
  const rows = await prisma.userSkill.findMany({
    where: { userId },
    orderBy: { skill: { label: "asc" } },
    take: MAX_USER_SKILLS,
    select: {
      skillId: true,
      level: true,
      validUntil: true,
      skill: { select: { key: true, label: true, category: true } },
    },
  });
  return rows.map(toUserSkillSummary);
}

export async function listUserSkills(
  actor: ServiceActor,
  userId: unknown,
): Promise<ServiceResult<UserSkillSummary[]>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const target = await findScopedStaff(actor, userId);
  if (!target) return fail("forbidden");

  return ok(await readUserSkills(target.id));
}

/**
 * Erstatter kompetanselisten til en ansatt. Kompetanser som ikke er med i
 * `inputs` fjernes, de øvrige opprettes eller oppdateres. Nivå er valgfritt
 * (1–5), og `validUntil` er en valgfri siste gyldighetsdato.
 */
export async function setUserSkills(
  actor: ServiceActor,
  userId: unknown,
  inputs: unknown,
): Promise<ServiceResult<UserSkillSummary[]>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const target = await findScopedStaff(actor, userId);
  if (!target) return fail("forbidden");

  const normalized = normalizeUserSkills(inputs);
  if (!normalized) return fail("invalid");

  if (normalized.length > 0) {
    const ids = normalized.map((entry) => entry.skillId);
    const found = await prisma.skill.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      const existingIds = new Set(found.map((skill) => skill.id));
      return fail("invalid", {
        unknownSkillIds: ids.filter((id) => !existingIds.has(id)),
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.userSkill.deleteMany({
      where:
        normalized.length > 0
          ? { userId: target.id, skillId: { notIn: normalized.map((entry) => entry.skillId) } }
          : { userId: target.id },
    });

    for (const entry of normalized) {
      await tx.userSkill.upsert({
        where: {
          userId_skillId: { userId: target.id, skillId: entry.skillId },
        },
        create: {
          userId: target.id,
          skillId: entry.skillId,
          level: entry.level,
          validUntil: entry.validUntil,
        },
        update: {
          level: entry.level,
          validUntil: entry.validUntil,
        },
      });
    }

    await audit(tx, {
      entityType: "User",
      entityId: target.id,
      action: `Oppdaterte kompetanse for ${target.name || "Ukjent"}`,
      actor: toAuditActor(actor),
    });
  });

  return ok(await readUserSkills(target.id));
}

// ---------------------------------------------------------------------------
// Ukentlig arbeidstid
// ---------------------------------------------------------------------------

export type AvailabilityWindowInput = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type UserAvailabilityWindow = AvailabilityWindowInput & {
  id: string;
};

function parseMinute(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const minute = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440) return null;
  return minute;
}

function parseWeekday(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const weekday = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  return weekday;
}

/**
 * Ren validering av ukentlige arbeidstidsvinduer.
 *
 * Mandag er 0 og søndag 6. Minuttene regnes fra midnatt i Europe/Oslo, og
 * slutten er eksklusiv (`08:00–12:00` er 480–720). Vinduer på samme ukedag
 * kan ikke overlappe, men de kan støte mot hverandre. Maks 50 vinduer per
 * ansatt. Returnerer sortert, normalisert liste eller null ved ugyldig data.
 */
export function normalizeAvailabilityWindows(
  input: unknown,
): AvailabilityWindowInput[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length > MAX_AVAILABILITY_WINDOWS) return null;

  const windows: AvailabilityWindowInput[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const weekday = parseWeekday(item.weekday);
    const startMinute = parseMinute(item.startMinute);
    const endMinute = parseMinute(item.endMinute);
    if (weekday === null || startMinute === null || endMinute === null) {
      return null;
    }
    if (startMinute >= endMinute) return null;
    windows.push({ weekday, startMinute, endMinute });
  }

  windows.sort(
    (left, right) =>
      left.weekday - right.weekday ||
      left.startMinute - right.startMinute ||
      left.endMinute - right.endMinute,
  );

  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const current = windows[index];
    if (
      previous.weekday === current.weekday &&
      current.startMinute < previous.endMinute
    ) {
      return null;
    }
  }

  return windows;
}

async function readUserAvailability(
  userId: string,
): Promise<UserAvailabilityWindow[]> {
  return prisma.userAvailability.findMany({
    where: { userId },
    orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
    take: MAX_AVAILABILITY_WINDOWS,
    select: { id: true, weekday: true, startMinute: true, endMinute: true },
  });
}

export async function listUserAvailability(
  actor: ServiceActor,
  userId: unknown,
): Promise<ServiceResult<UserAvailabilityWindow[]>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const target = await findScopedStaff(actor, userId);
  if (!target) return fail("forbidden");

  return ok(await readUserAvailability(target.id));
}

/** Erstatter hele den ukentlige arbeidstiden i én transaksjon. */
export async function replaceUserAvailability(
  actor: ServiceActor,
  userId: unknown,
  windows: unknown,
): Promise<ServiceResult<UserAvailabilityWindow[]>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const target = await findScopedStaff(actor, userId);
  if (!target) return fail("forbidden");

  const normalized = normalizeAvailabilityWindows(windows);
  if (!normalized) return fail("invalid");

  await prisma.$transaction(async (tx) => {
    await tx.userAvailability.deleteMany({ where: { userId: target.id } });
    if (normalized.length > 0) {
      await tx.userAvailability.createMany({
        data: normalized.map((window) => ({
          userId: target.id,
          weekday: window.weekday,
          startMinute: window.startMinute,
          endMinute: window.endMinute,
        })),
      });
    }
    await audit(tx, {
      entityType: "User",
      entityId: target.id,
      action: `Endret arbeidstid for ${target.name || "Ukjent"}`,
      actor: toAuditActor(actor),
    });
  });

  return ok(await readUserAvailability(target.id));
}

// ---------------------------------------------------------------------------
// Fravær
// ---------------------------------------------------------------------------

export type AbsenceSummary = {
  id: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  kind: AbsenceKind;
  note: string | null;
};

export type AbsenceInput = {
  userId?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  kind?: unknown;
  note?: unknown;
};

export type AbsenceUpdateInput = {
  id?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  kind?: unknown;
  note?: unknown;
};

export function isAbsenceKind(value: unknown): value is AbsenceKind {
  return (
    typeof value === "string" &&
    (ABSENCE_KINDS as readonly string[]).includes(value)
  );
}

/** Et fravær må ha positiv varighet og være høyst 365 døgn. */
export function isValidAbsencePeriod(startsAt: Date, endsAt: Date): boolean {
  if (
    !(startsAt instanceof Date) ||
    !(endsAt instanceof Date) ||
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime())
  ) {
    return false;
  }
  if (startsAt >= endsAt) return false;
  return endsAt.getTime() - startsAt.getTime() <= MAX_ABSENCE_MS;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Tolker et tidspunkt fra skjema. En ren dato (`YYYY-MM-DD`) betyr midnatt i
 * Oslo, og et `datetime-local`-tidspunkt uten tidssone tolkes også som
 * Oslo-veggklokke. Strenger med `Z` eller offset brukes som de er.
 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return isCalendarDate(text) ? osloDayStart(text) : null;
  }

  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (local) {
    const [, year, month, day, hour, minute, second = "0"] = local;
    const yearNumber = Number(year);
    const monthNumber = Number(month);
    const dayNumber = Number(day);
    const hourNumber = Number(hour);
    const minuteNumber = Number(minute);
    const secondNumber = Number(second);
    if (
      !isCalendarDate(`${year}-${month}-${day}`) ||
      hourNumber > 23 ||
      minuteNumber > 59 ||
      secondNumber > 59
    ) {
      return null;
    }
    const wallClock = Date.UTC(
      yearNumber,
      monthNumber - 1,
      dayNumber,
      hourNumber,
      minuteNumber,
      secondNumber,
    );
    let instant = new Date(wallClock);
    // To iterasjoner håndterer sommertidsovergangene, som i osloDayStart.
    for (let index = 0; index < 2; index += 1) {
      instant = new Date(wallClock - osloOffsetMinutes(instant) * 60_000);
    }
    return instant;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

const osloOffsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function osloOffsetMinutes(date: Date): number {
  const parts = osloOffsetFormatter.formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000;
}

type NormalizedNote = { ok: true; value: string | null } | { ok: false };

function normalizeNote(value: unknown): NormalizedNote {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const raw = value.trim();
  if (!raw) return { ok: true, value: null };
  if (raw.length > MAX_ABSENCE_NOTE) return { ok: false };
  return {
    ok: true,
    value: cleanText(raw, { maxLength: MAX_ABSENCE_NOTE, multiline: true }) || null,
  };
}

type AbsenceRow = {
  id: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  kind: string;
  note: string | null;
};

function toAbsenceSummary(row: AbsenceRow): AbsenceSummary {
  return {
    id: row.id,
    userId: row.userId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    // Bare verdier fra allowlisten kan lagres gjennom tjenesten. Eldre rader
    // med ukjent kind vises som ANNET i stedet for å krasje visningen.
    kind: isAbsenceKind(row.kind) ? row.kind : "ANNET",
    note: row.note,
  };
}

async function readAbsences(userId: string): Promise<AbsenceSummary[]> {
  const rows = await prisma.absence.findMany({
    where: { userId },
    orderBy: { startsAt: "desc" },
    take: MAX_ABSENCES,
    select: {
      id: true,
      userId: true,
      startsAt: true,
      endsAt: true,
      kind: true,
      note: true,
    },
  });
  return rows.map(toAbsenceSummary);
}

/**
 * Avgrenset liste over en ansatts fravær, nyeste først.
 *
 * Delvise overlapp mellom to fraværsperioder er tillatt – en sykmelding kan
 * for eksempel ligge inni en planlagt ferie. Nøyaktig samme start og slutt
 * avvises som en duplikat, slik at en dobbeltinnsending ikke lager to like
 * rader.
 */
export async function listAbsences(
  actor: ServiceActor,
  userId: unknown,
): Promise<ServiceResult<AbsenceSummary[]>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const target = await findScopedStaff(actor, userId);
  if (!target) return fail("forbidden");

  return ok(await readAbsences(target.id));
}

export async function createAbsence(
  actor: ServiceActor,
  input: AbsenceInput,
): Promise<ServiceResult<AbsenceSummary>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const target = await findScopedStaff(actor, input.userId);
  if (!target) return fail("forbidden");

  const startsAt = toDate(input.startsAt);
  const endsAt = toDate(input.endsAt);
  if (!startsAt || !endsAt || !isValidAbsencePeriod(startsAt, endsAt)) {
    return fail("invalid");
  }
  if (!isAbsenceKind(input.kind)) return fail("invalid");
  const kind = input.kind;

  const note = normalizeNote(input.note);
  if (!note.ok) return fail("invalid");

  const duplicate = await prisma.absence.findFirst({
    where: { userId: target.id, startsAt, endsAt },
    select: { id: true },
  });
  if (duplicate) return fail("conflict");

  const created = await prisma.$transaction(async (tx) => {
    const absence = await tx.absence.create({
      data: {
        userId: target.id,
        startsAt,
        endsAt,
        kind,
        note: note.value,
      },
      select: {
        id: true,
        userId: true,
        startsAt: true,
        endsAt: true,
        kind: true,
        note: true,
      },
    });
    await audit(tx, {
      entityType: "User",
      entityId: target.id,
      action: `Registrerte fravær for ${target.name || "Ukjent"}`,
      actor: toAuditActor(actor),
    });
    return absence;
  });

  return ok(toAbsenceSummary(created));
}

export async function updateAbsence(
  actor: ServiceActor,
  input: AbsenceUpdateInput,
): Promise<ServiceResult<AbsenceSummary>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const id = normalizeId(input.id);
  if (!id) return fail("invalid");

  const existing = await prisma.absence.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      startsAt: true,
      endsAt: true,
      kind: true,
      note: true,
    },
  });
  if (!existing) return fail("not_found");

  const target = await findScopedStaff(actor, existing.userId);
  if (!target) return fail("forbidden");

  const startsAt =
    input.startsAt === undefined ? existing.startsAt : toDate(input.startsAt);
  const endsAt =
    input.endsAt === undefined ? existing.endsAt : toDate(input.endsAt);
  if (!startsAt || !endsAt || !isValidAbsencePeriod(startsAt, endsAt)) {
    return fail("invalid");
  }

  const kind = input.kind === undefined ? existing.kind : input.kind;
  if (!isAbsenceKind(kind)) return fail("invalid");

  const note =
    input.note === undefined ? { ok: true as const, value: existing.note } : normalizeNote(input.note);
  if (!note.ok) return fail("invalid");

  const duplicate = await prisma.absence.findFirst({
    where: { userId: target.id, startsAt, endsAt, id: { not: existing.id } },
    select: { id: true },
  });
  if (duplicate) return fail("conflict");

  const updated = await prisma.$transaction(async (tx) => {
    const absence = await tx.absence.update({
      where: { id: existing.id },
      data: { startsAt, endsAt, kind, note: note.value },
      select: {
        id: true,
        userId: true,
        startsAt: true,
        endsAt: true,
        kind: true,
        note: true,
      },
    });
    await audit(tx, {
      entityType: "User",
      entityId: target.id,
      action: `Endret fravær for ${target.name || "Ukjent"}`,
      actor: toAuditActor(actor),
    });
    return absence;
  });

  return ok(toAbsenceSummary(updated));
}

export async function deleteAbsence(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult<undefined>> {
  if (!can(actor, "users.manage")) return fail("forbidden");

  const id = normalizeId(input.id);
  if (!id) return fail("invalid");

  const existing = await prisma.absence.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing) return fail("not_found");

  const target = await findScopedStaff(actor, existing.userId);
  if (!target) return fail("forbidden");

  await prisma.$transaction(async (tx) => {
    await tx.absence.delete({ where: { id: existing.id } });
    await audit(tx, {
      entityType: "User",
      entityId: target.id,
      action: `Slettet fravær for ${target.name || "Ukjent"}`,
      actor: toAuditActor(actor),
    });
  });

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Tilgjengelige teknikere
// ---------------------------------------------------------------------------

export type TimeRange = {
  startsAt: Date | string;
  endsAt: Date | string;
};

export type AvailableTechnicianOptions = {
  /**
   * Kompetansenøkler som kreves. Alle må være oppfylt (ikke bare én), og
   * kompetansen må være gyldig ved starten av intervallet.
   */
  skillKeys?: string[];
  /**
   * Når true returneres bare teknikere med en konfigurert arbeidstid som
   * dekker intervallet. Teknikere uten arbeidstid («unconfigured») utelates.
   */
  requiredOnly?: boolean;
};

export type AvailableTechnician = {
  id: string;
  name: string | null;
  departmentId: string | null;
  /** «unconfigured» betyr at den ansatte ikke har lagt inn arbeidstid. */
  availability: "available" | "unconfigured";
  skills: {
    key: string;
    label: string;
    category: string | null;
    level: number | null;
    validUntil: Date | null;
  }[];
};

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const osloMomentFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type OsloMoment = {
  /** Kalenderdato i Oslo, YYYY-MM-DD. */
  date: string;
  /** 0 = mandag … 6 = søndag. */
  weekday: number;
  /** Minutter fra midnatt, lokal Oslo-tid. */
  minute: number;
};

function osloMoment(date: Date): OsloMoment {
  const parts = osloMomentFormatter.formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: WEEKDAY_INDEX[value("weekday")] ?? 0,
    minute: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

/**
 * Teknikere som kan tildeles et tidsintervall.
 *
 * Regler, i den rekkefølgen de anvendes:
 *
 * 1. Aktøren må ha `users.view` eller `workorders.assign`, og resultatet er
 *    begrenset til `staffScopeFor(actor)` – egen avdeling for ikke-admin.
 *    Bare aktive, ikke-kundeportale ansatte i en aktiv avdeling er med.
 * 2. Ansatte med et fravær som overlapper intervallet utelates.
 * 3. Ansatte med en overlappende visitt som ikke er kansellert utelates.
 * 4. `skillKeys` krever at ALLE nøklene finnes på den ansatte og er gyldige
 *    ved intervallets start. Dette er bevisst «alle», ikke «minst én».
 * 5. Ukentlig arbeidstid: intervallet kan spenne over flere dager, men bare
 *    første Oslo-dag vurderes. Starttiden og sluttiden (kappet ved midnatt)
 *    må ligge innenfor ETT vindu på den dagens ukedag. Finnes ingen
 *    arbeidstidsrader i det hele tatt, regnes den ansatte som «ikke
 *    konfigurert» og tas med med `availability: "unconfigured"` – med mindre
 *    `requiredOnly` er satt. Finnes rader, men ingen dekker intervallet,
 *    utelates den ansatte.
 *
 * Resultatet er avgrenset til 200 teknikere.
 */
export async function availableTechnicians(
  actor: ServiceActor,
  range: TimeRange,
  options: AvailableTechnicianOptions = {},
): Promise<ServiceResult<AvailableTechnician[]>> {
  if (!can(actor, "users.view") && !can(actor, "workorders.assign")) {
    return fail("forbidden");
  }

  const startsAt = toDate(range?.startsAt);
  const endsAt = toDate(range?.endsAt);
  if (!startsAt || !endsAt || startsAt >= endsAt) return fail("invalid");

  let skillKeys: string[] = [];
  if (options.skillKeys !== undefined) {
    if (!Array.isArray(options.skillKeys)) return fail("invalid");
    const cleaned = options.skillKeys.map((key) =>
      typeof key === "string" ? key.trim() : "",
    );
    if (cleaned.some((key) => !isValidSkillKey(key))) return fail("invalid");
    skillKeys = [...new Set(cleaned)];
  }

  const firstDay = osloMoment(startsAt);
  const lastDay = osloMoment(endsAt);
  const endMinute = lastDay.date === firstDay.date ? lastDay.minute : 1440;

  const skillFilters: Prisma.UserWhereInput[] = skillKeys.map((key) => ({
    skills: {
      some: {
        skill: { key },
        OR: [{ validUntil: null }, { validUntil: { gte: startsAt } }],
      },
    },
  }));

  const rows = await prisma.user.findMany({
    where: {
      AND: [
        staffScopeFor(actor),
        {
          absences: {
            none: { startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
          },
        },
        {
          visitAssignments: {
            none: {
              visit: {
                status: { not: "CANCELLED" },
                startsAt: { lt: endsAt },
                endsAt: { gt: startsAt },
              },
            },
          },
        },
        ...skillFilters,
      ],
    },
    orderBy: { name: "asc" },
    take: MAX_TECHNICIANS,
    select: {
      id: true,
      name: true,
      departmentId: true,
      availability: {
        select: { weekday: true, startMinute: true, endMinute: true },
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
      },
      skills: {
        where: {
          OR: [{ validUntil: null }, { validUntil: { gte: startsAt } }],
        },
        select: {
          level: true,
          validUntil: true,
          skill: { select: { key: true, label: true, category: true } },
        },
        orderBy: { skill: { label: "asc" } },
      },
    },
  });

  const technicians: AvailableTechnician[] = [];
  for (const row of rows) {
    let availability: AvailableTechnician["availability"];

    if (row.availability.length === 0) {
      if (options.requiredOnly) continue;
      availability = "unconfigured";
    } else {
      const covered = row.availability.some(
        (window) =>
          window.weekday === firstDay.weekday &&
          window.startMinute <= firstDay.minute &&
          window.endMinute >= endMinute,
      );
      if (!covered) continue;
      availability = "available";
    }

    technicians.push({
      id: row.id,
      name: row.name,
      departmentId: row.departmentId,
      availability,
      skills: row.skills.map((entry) => ({
        key: entry.skill.key,
        label: entry.skill.label,
        category: entry.skill.category,
        level: entry.level,
        validUntil: entry.validUntil,
      })),
    });
  }

  return ok(technicians);
}
