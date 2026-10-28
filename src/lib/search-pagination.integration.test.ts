import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { searchReports } from "@/lib/search-sql";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

/**
 * Verifiserer at rapportsøket pagineres i databasen, ikke bare i de første
 * 500 kandidatene. Uten OFFSET ville side 26 vært tom selv om totalen sa 520.
 */
describeIntegration("searchReports – paginering over kandidatgrensen", () => {
  const marker = unique("BulkPumpe").replace(/-/g, "");
  const workOrderIds: string[] = [];
  let departmentId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-sok-avdeling") },
    });
    departmentId = department.id;

    const total = 520;
    const created = await prisma.workOrder.createManyAndReturn({
      data: Array.from({ length: total }, (_, index) => ({
        title: `${marker} oppdrag ${index}`,
        departmentId,
        status: "OPEN" as const,
      })),
      select: { id: true },
    });
    workOrderIds.push(...created.map((workOrder) => workOrder.id));

    const reportResult = await prisma.report.createMany({
      data: workOrderIds.map((workOrderId, index) => ({
        workOrderId,
        name: `${marker} rapport ${index}`,
        dataJson: "{}",
        requiresUnits: false,
        templateCategory: "SERVICE" as const,
        completedAt: new Date(Date.now() - index * 1000),
      })),
    });
    expect(reportResult.count).toBe(total);
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("gir ekte total og treff også langt forbi side 1", async () => {
    const expectedTotal = await prisma.report.count({
      where: { name: { contains: marker } },
    });
    expect(expectedTotal).toBe(520);

    const firstPage = await searchReports(marker, {
      limit: 20,
      offset: 0,
      includeCancelled: false,
    });
    expect(firstPage).toHaveLength(20);
    expect(firstPage[0].total).toBe(expectedTotal);

    const lastPage = await searchReports(marker, {
      limit: 20,
      offset: expectedTotal - 20,
      includeCancelled: false,
    });
    expect(lastPage.length).toBeGreaterThan(0);
    expect(lastPage[0].total).toBe(expectedTotal);
    expect(lastPage.map((hit) => hit.id)).not.toEqual(
      firstPage.map((hit) => hit.id),
    );
  });
});
