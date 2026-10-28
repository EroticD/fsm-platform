import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { backfillOrderNumbers } from "@/lib/order-number-backfill";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("order number backfill", () => {
  let departmentId = "";
  let plainId = "";
  let punctuationId = "";
  let collisionAId = "";
  let collisionBId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-ordrenummer-avdeling") },
    });
    departmentId = department.id;

    // Simulerer rader fra før normaliseringen: orderNumber finnes, men
    // orderNumberNormalized er tom.
    const plain = await prisma.workOrder.create({
      data: {
        title: unique("IT-legacy-1"),
        orderNumber: "  K-1001 / A ",
        orderNumberNormalized: null,
        departmentId,
        status: "OPEN",
      },
      select: { id: true },
    });
    plainId = plain.id;

    const punctuation = await prisma.workOrder.create({
      data: {
        title: unique("IT-legacy-2"),
        orderNumber: "k.1001",
        orderNumberNormalized: null,
        departmentId,
        status: "OPEN",
      },
      select: { id: true },
    });
    punctuationId = punctuation.id;
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({
      where: { id: { in: [plainId, punctuationId, collisionAId, collisionBId] } },
    });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("normaliserer eksisterende ordrenumre uten å endre visningsverdien", async () => {
    const result = await backfillOrderNumbers();
    expect(result.ok).toBe(true);

    const [plain, punctuation] = await Promise.all([
      prisma.workOrder.findUnique({
        where: { id: plainId },
        select: { orderNumber: true, orderNumberNormalized: true },
      }),
      prisma.workOrder.findUnique({
        where: { id: punctuationId },
        select: { orderNumber: true, orderNumberNormalized: true },
      }),
    ]);
    expect(plain?.orderNumber).toBe("  K-1001 / A ");
    expect(plain?.orderNumberNormalized).toBe("K1001A");
    expect(punctuation?.orderNumber).toBe("k.1001");
    expect(punctuation?.orderNumberNormalized).toBe("K1001");
  });

  it("avbryter uten å skrive når to ordrenumre normaliseres likt", async () => {
    const a = await prisma.workOrder.create({
      data: {
        title: unique("IT-kollisjon-a"),
        orderNumber: "K-9",
        orderNumberNormalized: null,
        departmentId,
        status: "OPEN",
      },
      select: { id: true },
    });
    collisionAId = a.id;
    const b = await prisma.workOrder.create({
      data: {
        title: unique("IT-kollisjon-b"),
        orderNumber: "k 9",
        orderNumberNormalized: null,
        departmentId,
        status: "OPEN",
      },
      select: { id: true },
    });
    collisionBId = b.id;

    const result = await backfillOrderNumbers();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.collisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            departmentId,
            normalized: "K9",
            count: 2,
          }),
        ]),
      );
    }

    const rows = await prisma.workOrder.findMany({
      where: { id: { in: [collisionAId, collisionBId] } },
      select: { orderNumber: true, orderNumberNormalized: true },
    });
    expect(rows.map((row) => row.orderNumber).sort()).toEqual(["K-9", "k 9"]);
    expect(rows.every((row) => row.orderNumberNormalized === null)).toBe(true);
  });
});
