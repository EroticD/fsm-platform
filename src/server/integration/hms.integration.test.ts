import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { submitReport } from "@/server/reports";
import type { AccessUser } from "@/lib/access";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("HMS-skjema på internt oppdrag", () => {
  let departmentId = "";
  let userId = "";
  let workOrderId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-HMS-avdeling") },
    });
    departmentId = department.id;

    const user = await prisma.user.create({
      data: {
        email: `${unique("hms")}@example.test`,
        name: "HMS-ansvarlig",
        role: "ADMIN",
        departmentId,
        isActive: true,
      },
    });
    userId = user.id;

    // Standardmalen installeres av migrasjonen. Testen dokumenterer at den
    // faktisk kan brukes på et internt oppdrag uten kunde.
    const workOrder = await prisma.workOrder.create({
      data: {
        title: unique("Internt HMS-oppdrag"),
        departmentId,
        customerId: null,
        status: "OPEN",
        templates: { connect: [{ id: "hms_sja_v1" }] },
      },
    });
    workOrderId = workOrder.id;
  });

  afterAll(async () => {
    await prisma.report.deleteMany({ where: { workOrderId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("lagrer HMS-kategori og type uten enheter", async () => {
    const user = (await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { department: true },
    })) as unknown as AccessUser;

    const formData = new FormData();
    formData.set("workOrderId", workOrderId);
    formData.set("templateId", "hms_sja_v1");
    formData.set("unitsJson", JSON.stringify([{ key: "report" }]));
    formData.set("status__report", "GODKJENT");
    formData.set("answer__report__sja_project", "Testanlegg");
    formData.set("answer__report__sja_task", "Kontroll av arbeid i høyden");
    formData.set("answer__report__sja_decision", "Arbeidet kan starte som planlagt");

    const result = await submitReport(user, formData);
    expect(result.ok).toBe(true);

    const report = await prisma.report.findUniqueOrThrow({
      where: {
        workOrderId_templateId: { workOrderId, templateId: "hms_sja_v1" },
      },
    });
    expect(report.templateCategory).toBe("HMS");
    expect(report.hmsType).toBe("SJA");
    expect(report.requiresUnits).toBe(false);
    expect(report.name).toBe("Sikker Jobb Analyse (SJA)");

    const workOrder = await prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrderId },
    });
    expect(workOrder.customerId).toBeNull();
  });
});
