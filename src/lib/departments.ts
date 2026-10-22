import prisma from "@/lib/prisma";

/** Aktive avdelinger, med standardavdelingen først. */
export async function getActiveDepartments() {
  return prisma.department.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

/**
 * Standardavdelingen brukes når en kunde booker et oppdrag, eller når en
 * administrator oppretter et oppdrag uten å velge avdeling.
 */
export async function getDefaultDepartmentId(): Promise<string | null> {
  const department = await prisma.department.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return department?.id ?? null;
}

/** Henter en aktiv avdeling, eller null hvis id-en er ukjent/inaktiv. */
export async function findActiveDepartment(id?: string | null) {
  if (!id) return null;
  return prisma.department.findFirst({
    where: { id, isActive: true },
    select: { id: true, name: true },
  });
}
