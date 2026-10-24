import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("Report: snapshot og unikhet", () => {
  let departmentId = "";
  let customerId = "";
  let workOrderId = "";
  let templateId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-avdeling") },
    });
    departmentId = department.id;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-kunde"), departmentId },
    });
    customerId = customer.id;

    const template = await prisma.template.create({
      data: { title: unique("IT-mal"), fieldsJson: "[]" },
    });
    templateId = template.id;

    const workOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-oppdrag"),
        departmentId,
        customerId,
        status: "OPEN",
      },
    });
    workOrderId = workOrder.id;
  });

  afterAll(async () => {
    await prisma.report.deleteMany({ where: { workOrderId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("lagrer malens øyeblikksbilde og avviser duplikat", async () => {
    const report = await prisma.report.create({
      data: {
        dataJson: "{}",
        workOrderId,
        templateId,
        templateTitle: "Sjekkliste",
        templateSnapshotJson: "[{\"id\":\"f1\"}]",
        isLocked: true,
      },
    });

    expect(report.templateTitle).toBe("Sjekkliste");
    expect(report.templateSnapshotJson).toContain("\"f1\"");

    await expect(
      prisma.report.create({
        data: { dataJson: "{}", workOrderId, templateId },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
