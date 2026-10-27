import type { HmsFormType } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { AccessUser } from "@/lib/access";
import { HMS_FORM_GROUPS } from "@/lib/hms";
import {
  can,
  fail,
  ok,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import { addTemplate } from "./work-orders";

/**
 * Tjenestelaget for HMS-biblioteket.
 *
 * Biblioteket er en egen inngang til HMS-malene og HMS-dokumentasjonen. Det
 * leser de samme dataene som mal- og rapportvisningene, men samler dem i én
 * oversikt. Skriving skjer fortsatt gjennom oppdragstjenesten, slik at
 * rettigheter, avdelingssperre og revisjonslogg er de samme som ellers.
 */

export type HmsTemplateSummary = {
  id: string;
  title: string;
  reportName: string | null;
  description: string | null;
  hmsType: HmsFormType | null;
  reportCount: number;
  workOrderCount: number;
};

export type HmsReportSummary = {
  id: string;
  reportName: string | null;
  completedAt: Date;
  isLocked: boolean;
  hmsType: HmsFormType | null;
  workOrder: {
    id: string;
    title: string;
    orderNumber: string | null;
    status: string;
    customerId: string | null;
    customerName: string | null;
  };
};

export type HmsWorkOrderOption = {
  id: string;
  title: string;
  orderNumber: string | null;
  status: string;
  customerId: string | null;
  customerName: string | null;
  /** Interne oppdrag (uten kunde) merkes tydelig i skjemaet. */
  kind: "internal" | "customer";
};

export type HmsTypeCount = {
  type: HmsFormType;
  count: number;
};

export type HmsOverview = {
  templates: HmsTemplateSummary[];
  recentReports: HmsReportSummary[];
  workOrders: HmsWorkOrderOption[];
  countsByType: HmsTypeCount[];
  permissions: {
    canViewLibrary: boolean;
    canViewReports: boolean;
    canManageTemplates: boolean;
    canLinkTemplates: boolean;
  };
};

/** Klassifiserer et oppdrag ut fra om det har en kunde. */
export function hmsWorkOrderKind(
  customerId: string | null | undefined,
): "internal" | "customer" {
  return customerId ? "customer" : "internal";
}

function isUsableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 200
  );
}

/**
 * Alt HMS-siden trenger for én visning.
 *
 * `templates.view` gir malbiblioteket, `reports.view` gir dokumentasjonen.
 * En bruker som bare har den ene rettigheten får den delen hen kan se, uten
 * at den andre spørringen kjøres i det hele tatt.
 */
export async function getHmsOverview(
  actor: ServiceActor,
): Promise<ServiceResult<HmsOverview>> {
  if (!actor.isActive || actor.role === "CUSTOMER") return fail("forbidden");

  const canViewLibrary = can(actor, "templates.view");
  const canViewReports = can(actor, "reports.view");
  if (!canViewLibrary && !canViewReports) return fail("forbidden");

  const canManageTemplates = can(actor, "templates.manage");
  const canLinkTemplates =
    canViewLibrary &&
    (can(actor, "workorders.edit") || can(actor, "workorders.update"));

  const templates: HmsTemplateSummary[] = canViewLibrary
    ? (
        await prisma.template.findMany({
          where: { category: "HMS" },
          orderBy: { title: "asc" },
          include: {
            _count: { select: { reports: true, workOrder: true } },
          },
        })
      ).map((template) => ({
        id: template.id,
        title: template.title,
        reportName: template.reportName,
        description: template.description,
        hmsType: template.hmsType,
        reportCount: template._count.reports,
        workOrderCount: template._count.workOrder,
      }))
    : [];

  // Rapporter er felles på tvers av avdelinger i rapportlisten, men HMS-siden
  // er en oppdragsoversikt og følger derfor samme avdelingssperre som
  // oppdragene. Det hindrer at HMS-dokumentasjon lekker på tvers av avdelinger.
  const reports = canViewReports
    ? await prisma.report.findMany({
        where: {
          templateCategory: "HMS",
          deletedAt: null,
          workOrder: workOrderScopeFor(actor),
        },
        orderBy: { completedAt: "desc" },
        take: 50,
        select: {
          id: true,
          name: true,
          templateTitle: true,
          completedAt: true,
          isLocked: true,
          hmsType: true,
          template: { select: { title: true } },
          workOrder: {
            select: {
              id: true,
              title: true,
              orderNumber: true,
              status: true,
              customerId: true,
              customer: { select: { name: true } },
            },
          },
        },
      })
    : [];

  // Bare oppdrag som faktisk kan få et nytt skjema. Fullførte og kansellerte
  // oppdrag er låst i oppdragstjenesten, så de utelates allerede her.
  const workOrders = canLinkTemplates
    ? await prisma.workOrder.findMany({
        where: {
          ...workOrderScopeFor(actor),
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
        orderBy: [{ scheduledFor: { sort: "desc", nulls: "last" } }],
        take: 100,
        select: {
          id: true,
          title: true,
          orderNumber: true,
          status: true,
          customerId: true,
          customer: { select: { name: true } },
        },
      })
    : [];

  return ok({
    templates,
    recentReports: reports.map((report) => ({
      id: report.id,
      reportName:
        report.name || report.templateTitle || report.template?.title || null,
      completedAt: report.completedAt,
      isLocked: report.isLocked,
      hmsType: report.hmsType,
      workOrder: {
        id: report.workOrder.id,
        title: report.workOrder.title,
        orderNumber: report.workOrder.orderNumber,
        status: report.workOrder.status,
        customerId: report.workOrder.customerId,
        customerName: report.workOrder.customer?.name ?? null,
      },
    })),
    workOrders: workOrders.map((workOrder) => ({
      id: workOrder.id,
      title: workOrder.title,
      orderNumber: workOrder.orderNumber,
      status: workOrder.status,
      customerId: workOrder.customerId,
      customerName: workOrder.customer?.name ?? null,
      kind: hmsWorkOrderKind(workOrder.customerId),
    })),
    countsByType: HMS_FORM_GROUPS.map(({ type }) => ({
      type,
      count: templates.filter((template) => template.hmsType === type).length,
    })),
    permissions: {
      canViewLibrary,
      canViewReports,
      canManageTemplates,
      canLinkTemplates,
    },
  });
}

function mapWorkOrderError(error: string) {
  switch (error) {
    case "ikke-tilgang":
      return "forbidden" as const;
    case "ikke-funnet":
      return "not_found" as const;
    case "workorder-locked":
      return "conflict" as const;
    case "ugyldig-data":
      return "invalid" as const;
    default:
      return "error" as const;
  }
}

/**
 * Knytter en HMS-mal til et oppdrag.
 *
 * Selve koblingen gjøres av `addTemplate` i oppdragstjenesten. Da gjelder
 * nøyaktig samme avdelingssperre, låsing av fullførte oppdrag og revisjonslogg
 * som når skjemaet legges til fra oppdragssiden. Her kontrolleres i tillegg at
 * brukeren har malbiblioteket tilgjengelig og at malen faktisk er en HMS-mal.
 */
export async function linkHmsTemplateToWorkOrder(
  actor: ServiceActor,
  workOrderId: string,
  templateId: string,
): Promise<ServiceResult<{ workOrderId: string }>> {
  if (!actor.isActive || actor.role === "CUSTOMER") return fail("forbidden");
  if (!can(actor, "templates.view")) return fail("forbidden");

  const canEdit = can(actor, "workorders.edit");
  const canUpdate = can(actor, "workorders.update");
  if (!canEdit && !canUpdate) return fail("forbidden");

  if (!isUsableId(workOrderId) || !isUsableId(templateId)) {
    return fail("invalid");
  }

  const template = await prisma.template.findFirst({
    where: { id: templateId.trim(), category: "HMS" },
    select: { id: true },
  });
  if (!template) return fail("invalid");

  const permission = canEdit ? "workorders.edit" : "workorders.update";
  // `addTemplate` er typet mot den fulle innloggede brukeren. Tjenestelaget
  // bruker den smalere ServiceActor, men feltene addTemplate faktisk leser
  // (rolle, avdeling, rettigheter og aktiv status) finnes på begge.
  const result = await addTemplate(
    actor as unknown as AccessUser,
    workOrderId.trim(),
    templateId.trim(),
    permission,
  );
  if (!result.ok) return fail(mapWorkOrderError(result.error));

  return ok({ workOrderId: workOrderId.trim() });
}
