import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { submitReport } from "@/server/reports";
import type { AccessUser } from "@/lib/access";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("Automatisk utbedringsoppdrag ved avvik", () => {
  let departmentId = "";
  let customerId = "";
  let userId = "";
  let templateId = "";
  let workOrderId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-avvik-avdeling") },
    });
    departmentId = department.id;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-avvik-kunde"), departmentId },
    });
    customerId = customer.id;

    const user = await prisma.user.create({
      data: {
        email: `${unique("avvik")}@example.test`,
        name: "Avviksrapportør",
        role: "TECHNICIAN",
        departmentId,
        isActive: true,
      },
    });
    userId = user.id;

    const template = await prisma.template.create({
      data: {
        title: unique("Avviksmal"),
        reportName: "Avvikskontroll",
        requiresUnits: true,
        fieldsJson: "[]",
      },
    });
    templateId = template.id;

    const workOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-avviksoppdrag"),
        departmentId,
        customerId,
        status: "OPEN",
        templates: { connect: [{ id: templateId }] },
      },
    });
    workOrderId = workOrder.id;
  });

  afterAll(async () => {
    const reports = await prisma.report.findMany({
      where: { workOrderId },
      select: { id: true },
    });
    const reportIds = reports.map((report) => report.id);
    await prisma.workOrder.deleteMany({
      where: { deviationSourceKey: { in: reportIds.map((id) => `report:${id}`) } },
    });
    await prisma.report.deleteMany({ where: { workOrderId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.template.deleteMany({ where: { id: templateId } });
    await prisma.product.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("oppretter ett udatert utbedringsoppdrag tildelt rapportøren", async () => {
    const user = (await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { department: true },
    })) as unknown as AccessUser;

    const formData = new FormData();
    formData.set("workOrderId", workOrderId);
    formData.set("templateId", templateId);
    formData.set(
      "unitsJson",
      JSON.stringify([
        {
          key: "unit-1",
          label: "Hovedpumpe",
          serialNumber: "SN-1",
          location: "Kjeller",
        },
      ]),
    );
    formData.set("status__unit-1", "AVVIK");
    formData.set("comment__unit-1", "Lekkasje ved pakning");

    const result = await submitReport(user, formData);
    expect(result.ok).toBe(true);

    const report = await prisma.report.findUniqueOrThrow({
      where: { workOrderId_templateId: { workOrderId, templateId } },
    });
    const remediation = await prisma.workOrder.findUniqueOrThrow({
      where: { deviationSourceKey: `report:${report.id}` },
      include: { technicians: { select: { id: true } } },
    });

    expect(remediation.status).toBe("OPEN");
    expect(remediation.scheduledFor).toBeNull();
    expect(remediation.scheduledTo).toBeNull();
    expect(remediation.customerId).toBe(customerId);
    expect(remediation.departmentId).toBe(departmentId);
    expect(remediation.technicians.map((technician) => technician.id)).toEqual([userId]);
    expect(remediation.description).toContain("Hovedpumpe");
    expect(remediation.description).toContain("Lekkasje ved pakning");
    expect(result).toMatchObject({ remediationWorkOrderId: remediation.id });

    // Ny innsending etter opplåsing skal ikke lage et nytt utbedringsoppdrag.
    await prisma.report.update({
      where: { id: report.id },
      data: { isLocked: false },
    });
    const second = await submitReport(user, formData);
    expect(second.ok).toBe(true);
    expect(
      await prisma.workOrder.count({
        where: { deviationSourceKey: `report:${report.id}` },
      }),
    ).toBe(1);
  });
});
