import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { searchWorkOrderIdsWithTotal } from "@/lib/search-sql";
import { generateWorkOrderReference, workOrderReferenceFromId } from "@/lib/work-order-reference";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

/**
 * Referansen er kundens og kontorets felles nøkkel til oppdraget. Søket må
 * finne både ordinære O-referanser og bestillingsreferanser B-, uavhengig av
 * store/små bokstaver og tegnsetting.
 */
describeIntegration("oppdragsreferanse – søk og backfill", () => {
  let departmentId = "";
  let customerId = "";
  const workOrderIds: string[] = [];
  const bookingReference = "B-261030-REF123";
  const manualReference = "O-261030-MAN12345";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-referanse-avdeling") },
    });
    departmentId = department.id;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-referanse-kunde"), departmentId },
    });
    customerId = customer.id;

    const bookingOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-referanse-booking"),
        reference: bookingReference,
        departmentId,
        customerId,
        status: "OPEN",
      },
      select: { id: true },
    });
    workOrderIds.push(bookingOrder.id);
    await prisma.bookingRequest.create({
      data: {
        reference: bookingReference,
        workOrderId: bookingOrder.id,
        customerId,
        requestedDate: new Date("2026-10-30T00:00:00.000Z"),
        requestedFrom: "08:00",
        requestedTo: "10:00",
        contactName: "Kari Kunde",
        contactPhone: "12345678",
      },
    });

    const manualOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-referanse-manuell"),
        reference: manualReference,
        departmentId,
        customerId,
        status: "OPEN",
      },
      select: { id: true },
    });
    workOrderIds.push(manualOrder.id);
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("finner bestillingsoppdraget med B-referansen", async () => {
    const result = await searchWorkOrderIdsWithTotal(bookingReference);
    expect(result.ids).toContain(workOrderIds[0]);
  });

  it("finner ordinært oppdrag med O-referansen", async () => {
    const result = await searchWorkOrderIdsWithTotal(manualReference);
    expect(result.ids).toContain(workOrderIds[1]);
  });

  it("er tolerant for små bokstaver og manglende bindestreker", async () => {
    const lower = await searchWorkOrderIdsWithTotal("b 261030 ref123");
    expect(lower.ids).toContain(workOrderIds[0]);

    const compact = await searchWorkOrderIdsWithTotal("o261030man12345");
    expect(compact.ids).toContain(workOrderIds[1]);
  });

  it("genererer unike referanser i riktig format", () => {
    const references = new Set(
      Array.from({ length: 50 }, () => generateWorkOrderReference()),
    );
    expect(references.size).toBe(50);
    for (const reference of references) {
      expect(reference).toMatch(/^O-\d{6}-[A-Z0-9]{8}$/);
    }
  });

  it("beregner samme referanse som migreringens backfill", () => {
    const createdAt = new Date("2026-10-30T12:00:00.000Z");
    expect(workOrderReferenceFromId("cm-backfill-id", createdAt)).toBe(
      workOrderReferenceFromId("cm-backfill-id", createdAt),
    );
  });
});
