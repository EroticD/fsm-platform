// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data og
// oversettes ved visning i audit-actions.ts.
import fs from "fs/promises";
import path from "path";
import crypto from "node:crypto";
import { WorkStatus, type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { releaseUpload } from "@/lib/upload-cleanup";
import {
  contactCreateSchema,
  contactUpdateSchema,
  customerCreateSchema,
  customerUpdateSchema,
} from "@/lib/schemas/customer";
import {
  contractCreateSchema,
  contractDeleteSchema,
  contractToggleSchema,
} from "@/lib/schemas/contract";
import { unitCreateSchema, unitUpdateSchema } from "@/lib/schemas/unit";
import {
  firstOccurrenceOnOrAfter,
  parseDateOnly,
  todayUtc,
} from "@/lib/dates";
import {
  contractIntervalLabel,
  isContractInterval,
} from "@/lib/contracts";
import { generateRecurringWorkOrderForContract } from "@/lib/recurring";
import {
  getActiveDepartments,
  getDefaultDepartmentId,
} from "@/lib/departments";
import {
  LIMITS,
  cleanEmail,
  cleanMarkdown,
  cleanPhone,
  cleanText,
} from "@/lib/sanitize";
import { claimUpload } from "@/lib/upload-access";
import { uploadDir } from "@/lib/uploads";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import { reportWorkOrderScope } from "@/lib/report-scope";

/** Bare filer som ligger i opplastingsmappen kan knyttes til en kunde. */
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

function attachmentPath(fileUrl: string): string | null {
  if (!UPLOAD_URL.test(fileUrl)) return null;
  return path.join(uploadDir(), path.basename(fileUrl));
}

export const CUSTOMER_ACTIVE_STATUSES: WorkStatus[] = [
  WorkStatus.PLANNED,
  WorkStatus.IN_PROGRESS,
  WorkStatus.PENDING,
  WorkStatus.OPEN,
  WorkStatus.WAITING,
];

const ACTIVE_STATUSES = CUSTOMER_ACTIVE_STATUSES;

/**
 * Rapportene på kundekortet og i enhetshistorikken følger rapportomfanget:
 * bare administrator og roller med `reports.viewAllDepartments` ser rapporter
 * fra andre avdelinger. Montører skal i tillegg ikke se rapporter fra
 * kansellerte oppdrag, mens kontor og administrator beholder historikken.
 */
function reportWorkOrderScopeFor(
  actor: ServiceActor,
): Prisma.WorkOrderWhereInput {
  const scope: Prisma.WorkOrderWhereInput = {
    deletedAt: null,
    ...reportWorkOrderScope(actor),
  };
  if (actor.role !== "TECHNICIAN") return scope;
  return { AND: [scope, { status: { not: "CANCELLED" } }] };
}

/** Kundekortet viser 25 oppdrag om gangen, ikke hele historikken. */
export const CUSTOMER_ORDER_PAGE_SIZE = 25;

/** Antall rader i den sammenslåtte aktivitetsstrømmen. */
export const CUSTOMER_ACTIVITY_LIMIT = 25;

/**
 * Hvor mange oppdrag og rapporter vi henter id-er for når aktivitetsstrømmen
 * bygges. Revisjonsloggen har ingen relasjon til kunden, så vi må begrense
 * id-utvalget. Grensen holder strømmen rask også for store kunder.
 */
const CUSTOMER_ACTIVITY_ENTITY_LIMIT = 100;

export type CustomerTab =
  | "oversikt"
  | "oppdrag"
  | "utstyr"
  | "avtaler"
  | "mer";

export type CustomerTabSection =
  | "vedlegg"
  | "kontakter"
  | "portal"
  | "aktivitet"
  | null;

export type ResolvedCustomerTab = {
  tab: CustomerTab;
  section: CustomerTabSection;
};

/**
 * Nye faner har fem toppnivåer. De gamle fane-adressene beholdes som alias,
 * slik at bokmerker, varsler og handlinger som redirecter med ?tab= fortsatt
 * lander på riktig innhold.
 */
const CUSTOMER_TAB_ALIASES: Record<string, ResolvedCustomerTab> = {
  oversikt: { tab: "oversikt", section: null },
  oppdrag: { tab: "oppdrag", section: null },
  utstyr: { tab: "utstyr", section: null },
  avtaler: { tab: "avtaler", section: null },
  mer: { tab: "mer", section: null },
  // Eldre navn på Utstyr-fanen.
  enheter: { tab: "utstyr", section: null },
  // Fanene som nå bor under «Mer».
  vedlegg: { tab: "mer", section: "vedlegg" },
  dokumenter: { tab: "mer", section: "vedlegg" },
  kontakter: { tab: "mer", section: "kontakter" },
  kontakt: { tab: "mer", section: "kontakter" },
  portal: { tab: "mer", section: "portal" },
  aktivitet: { tab: "mer", section: "aktivitet" },
};

export function resolveCustomerTab(tab?: string | null): ResolvedCustomerTab {
  const key = (tab ?? "").trim().toLowerCase();
  return CUSTOMER_TAB_ALIASES[key] ?? CUSTOMER_TAB_ALIASES.oversikt;
}

export type CustomerActivityKind =
  | "customer"
  | "workOrder"
  | "report"
  | "contact";

export type CustomerActivityItem = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userName: string;
  createdAt: Date;
  kind: CustomerActivityKind;
  href: string | null;
};

/**
 * Valgfri avdeling og ansvarlig montør må peke på en aktiv avdeling og en
 * aktiv intern bruker. Ukjente eller slettede id-er avvises i stedet for å
 * lagres som en død referanse på kundekortet.
 */
async function validCustomerReferences(
  departmentId: string | undefined,
  responsibleTechnicianId: string | undefined,
): Promise<boolean> {
  if (departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: departmentId, isActive: true },
      select: { id: true },
    });
    if (!department) return false;
  }

  if (responsibleTechnicianId) {
    const technician = await prisma.user.findFirst({
      where: {
        id: responsibleTechnicianId,
        isActive: true,
        role: { not: "CUSTOMER" },
      },
      select: { id: true },
    });
    if (!technician) return false;
  }

  return true;
}

export type CustomerDetailParams = {
  tab: string;
  orderPage: number;
  /** Fritekstsøk i Utstyr-fanen (modell, serienummer eller plassering). */
  unitQuery?: string;
};

/** Grunndataene og de avgrensede listene kundekortet trenger. */
export async function getCustomerDetail(
  actor: ServiceActor,
  customerId: string,
  params: CustomerDetailParams,
) {
  if (!can(actor, "customers.view")) return fail("forbidden");

  const office = can(actor, "customers.manage");
  const isAdmin = isAdminActor(actor);
  const canViewReports = can(actor, "reports.view");
  const canViewEquipment = can(actor, "equipment.view");
  const { tab: currentTab } = resolveCustomerTab(params.tab);
  const orderPage = Math.max(1, params.orderPage);
  const unitQuery = cleanText(params.unitQuery, { maxLength: LIMITS.short });
  const loadMerTab = currentTab === "mer";

  // Rapportsvarene på enhetene er bare synlige med reports.view. Uten den
  // returnerer spørringen null rader i stedet for å fjerne feltene, slik at
  // formen på kundekortet er stabil.
  const reportUnitWhere: Prisma.ReportUnitWhereInput = canViewReports
    ? {
        report: {
          deletedAt: null,
          workOrder: reportWorkOrderScopeFor(actor),
        },
      }
    : { id: { in: [] } };

  // Kunder, kontakter, enheter, avtaler, dokumenter og rapporter er felles for
  // alle avdelinger. Oppdragene på kundekortet er derimot avdelingssperret.
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    include: {
      department: true,
      responsibleTechnician: true,
      contacts: { orderBy: { name: "asc" }, take: 100 },
      contracts: {
        orderBy: { startDate: "desc" },
        take: 50,
        include: {
          department: true,
          template: true,
          workOrders: {
            where: workOrderScopeFor(actor),
            orderBy: { scheduledFor: "desc" },
            take: 1,
            select: { id: true, title: true, scheduledFor: true, status: true },
          },
        },
      },
      attachments: { orderBy: { createdAt: "desc" }, take: 100 },
      _count: {
        select: {
          contacts: true,
          contracts: true,
          products: true,
          attachments: true,
        },
      },
    },
  });
  if (!customer) return fail("not_found");

  const templates = office
    ? await prisma.template.findMany({ orderBy: { title: "asc" } })
    : [];
  const departments = isAdmin ? await getActiveDepartments() : [];
  const defaultDepartmentId = office ? await getDefaultDepartmentId() : null;

  // Kansellerte oppdrag er avsluttet og skal ikke vises til montørene.
  // Kontoret ser dem fortsatt i kundekortet.
  const statusFilter: Prisma.WorkOrderWhereInput[] =
    actor.role !== "TECHNICIAN" ? [] : [{ status: { not: "CANCELLED" } }];
  const orderWhere: Prisma.WorkOrderWhereInput = {
    customerId,
    AND: [workOrderScopeFor(actor), ...statusFilter],
  };
  // Rapporter på kundekortet følger rapportomfanget, ikke oppdragslisten:
  // bare administrator og reports.viewAllDepartments ser andre avdelinger.
  const reportOrderWhere: Prisma.WorkOrderWhereInput = {
    customerId,
    ...reportWorkOrderScopeFor(actor),
  };

  // Aktivitetsstrømmen skal vise alt som faktisk har skjedd med kunden:
  // kundekortet, oppdragene, rapportene og kontaktpersonene. Revisjonsloggen
  // har ingen kunde-relasjon, så vi henter et begrenset utvalg id-er først.
  // Oppdragene er avdelingssperret, og rapportene følger rapportomfanget i
  // tillegg til reports.view. Dermed lekker ikke andre avdelingers historikk inn.
  const loadActivity = currentTab === "oversikt" || loadMerTab;
  let activityWorkOrderIds: string[] = [];
  let activityReportWorkOrders = new Map<string, string>();

  if (loadActivity) {
    const [activityWorkOrderRows, activityReportRows] = await Promise.all([
      prisma.workOrder.findMany({
        where: orderWhere,
        orderBy: { updatedAt: "desc" },
        take: CUSTOMER_ACTIVITY_ENTITY_LIMIT,
        select: { id: true },
      }),
      canViewReports
        ? prisma.report.findMany({
            where: { deletedAt: null, workOrder: reportOrderWhere },
            orderBy: { completedAt: "desc" },
            take: CUSTOMER_ACTIVITY_ENTITY_LIMIT,
            select: { id: true, workOrderId: true },
          })
        : Promise.resolve([] as Array<{ id: string; workOrderId: string }>),
    ]);

    activityWorkOrderIds = activityWorkOrderRows.map((row) => row.id);
    activityReportWorkOrders = new Map(
      activityReportRows.map((row) => [row.id, row.workOrderId]),
    );
  }

  const contactIds = customer.contacts.map((contact) => contact.id);
  const activityAuditFilters: Prisma.AuditLogWhereInput[] = [
    { entityType: "Customer", entityId: customerId },
  ];
  if (contactIds.length > 0) {
    activityAuditFilters.push({
      entityType: "Contact",
      entityId: { in: contactIds },
    });
  }
  if (activityWorkOrderIds.length > 0) {
    activityAuditFilters.push({
      entityType: "WorkOrder",
      entityId: { in: activityWorkOrderIds },
    });
  }
  if (activityReportWorkOrders.size > 0) {
    activityAuditFilters.push({
      entityType: "Report",
      entityId: { in: [...activityReportWorkOrders.keys()] },
    });
  }

  const [
    activityLogs,
    customerAuditLogs,
    customerComments,
    portalUsers,
  ] = await Promise.all([
    loadActivity
      ? prisma.auditLog.findMany({
          where: { OR: activityAuditFilters },
          orderBy: { createdAt: "desc" },
          take: CUSTOMER_ACTIVITY_LIMIT,
        })
      : Promise.resolve([]),
    // Revisjonsloggen under «Mer» viser bare kundens egne rader. Den er en
    // fallback for hendelser som ikke har en egen side å lenke til.
    loadMerTab
      ? prisma.auditLog.findMany({
          where: { entityType: "Customer", entityId: customerId },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    loadMerTab
      ? prisma.comment.findMany({
          where: { customerId },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    (loadMerTab || currentTab === "oversikt") && office
      ? prisma.user.findMany({
          where: { customerId, role: "CUSTOMER" },
          orderBy: { name: "asc" },
          include: { contact: true },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  const activityWorkOrderIdSet = new Set(activityWorkOrderIds);
  const activityFeed: CustomerActivityItem[] = activityLogs.flatMap((log) => {
    let kind: CustomerActivityKind;
    let href: string | null;

    switch (log.entityType) {
      case "WorkOrder":
        if (!activityWorkOrderIdSet.has(log.entityId)) return [];
        kind = "workOrder";
        href = `/oppdrag/${log.entityId}`;
        break;
      case "Report": {
        const workOrderId = activityReportWorkOrders.get(log.entityId);
        if (!workOrderId) return [];
        kind = "report";
        href = `/rapporter/${workOrderId}`;
        break;
      }
      case "Contact":
        kind = "contact";
        href = `/kunder/${customerId}?tab=mer#kontakter`;
        break;
      case "Customer":
        kind = "customer";
        href = `/kunder/${customerId}?tab=mer#aktivitet`;
        break;
      default:
        return [];
    }

    return [
      {
        id: log.id,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        userName: log.userName,
        createdAt: log.createdAt,
        kind,
        href,
      },
    ];
  });

  // Enhetsfanen lastes først når den åpnes. Servicehistorikken per enhet er
  // begrenset til de 25 nyeste kontrollene; totalen kommer fra _count.
  // Enheter og servicehistorikk krever equipment.view. Historikken er i
  // tillegg begrenset til oppdrag aktøren kan se, og til reports.view.
  const unitSearch: Prisma.ProductWhereInput = unitQuery
    ? {
        OR: [
          { model: { contains: unitQuery, mode: "insensitive" } },
          { serialNumber: { contains: unitQuery, mode: "insensitive" } },
          { location: { contains: unitQuery, mode: "insensitive" } },
        ],
      }
    : {};

  const products =
    currentTab === "utstyr" && canViewEquipment
      ? await prisma.product.findMany({
          where: { customerId, ...unitSearch },
          orderBy: { model: "asc" },
          take: 100,
          include: {
            reportUnits: {
              where: reportUnitWhere,
              orderBy: { createdAt: "desc" },
              take: 25,
              include: {
                report: {
                  select: {
                    id: true,
                    createdAt: true,
                    workOrderId: true,
                    template: { select: { title: true, fieldsJson: true } },
                    workOrder: {
                      select: { id: true, title: true, scheduledFor: true },
                    },
                  },
                },
              },
            },
            _count: {
              select: { reportUnits: { where: reportUnitWhere } },
            },
          },
        })
      : [];

  const loadOrders =
    currentTab === "oppdrag" || currentTab === "oversikt";

  const [
    totalOrders,
    activeOrders,
    completedOrders,
    reportCount,
    nextOrder,
    orderRows,
  ] = await Promise.all([
    prisma.workOrder.count({ where: orderWhere }),
    prisma.workOrder.count({
      where: { AND: [orderWhere, { status: { in: ACTIVE_STATUSES } }] },
    }),
    prisma.workOrder.count({
      where: { AND: [orderWhere, { status: "COMPLETED" }] },
    }),
    prisma.report.count({
      where: { deletedAt: null, workOrder: reportOrderWhere },
    }),
    prisma.workOrder.findFirst({
      where: {
        AND: [
          orderWhere,
          { status: { in: ACTIVE_STATUSES } },
          { scheduledFor: { gte: new Date() } },
        ],
      },
      orderBy: { scheduledFor: "asc" },
      select: { id: true, title: true, scheduledFor: true, status: true },
    }),
    loadOrders
      ? prisma.workOrder.findMany({
          where: orderWhere,
          orderBy: { scheduledFor: "desc" },
          take:
            currentTab === "oppdrag" ? CUSTOMER_ORDER_PAGE_SIZE : 3,
          skip:
            currentTab === "oppdrag"
              ? (orderPage - 1) * CUSTOMER_ORDER_PAGE_SIZE
              : 0,
          select: {
            id: true,
            title: true,
            status: true,
            scheduledFor: true,
            description: true,
            technicians: { select: { name: true }, take: 10 },
            _count: { select: { reports: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return ok({
    customer,
    customerAuditLogs,
    customerComments,
    activityFeed,
    recentActivity: activityFeed.slice(0, 5),
    portalUsers,
    templates,
    departments,
    defaultDepartmentId,
    products,
    totalOrders,
    activeOrders,
    completedOrders,
    reportCount,
    nextOrder,
    visibleWorkOrders: orderRows,
    orderTotalPages: Math.max(
      1,
      Math.ceil(totalOrders / CUSTOMER_ORDER_PAGE_SIZE),
    ),
    recentOrders:
      currentTab === "oppdrag" ? [] : orderRows.slice(0, 3),
  });
}

export type CustomerDetailResult = Awaited<
  ReturnType<typeof getCustomerDetail>
>;
export type CustomerDetailData = Extract<
  CustomerDetailResult,
  { ok: true }
>["data"];

/**
 * Én enhet med kunden den hører til og den avgrensede servicehistorikken.
 * Enheter er felles for alle avdelinger, men historikken følger oppdragene
 * aktøren kan se og krever reports.view.
 */
export async function getUnitDetail(actor: ServiceActor, unitId: string) {
  if (!can(actor, "customers.view") || !can(actor, "equipment.view")) {
    return fail("forbidden");
  }

  const canViewReports = can(actor, "reports.view");
  const reportUnitWhere: Prisma.ReportUnitWhereInput = canViewReports
    ? {
        report: {
          deletedAt: null,
          workOrder: reportWorkOrderScopeFor(actor),
        },
      }
    : { id: { in: [] } };

  const id = cleanText(unitId, { maxLength: LIMITS.line });
  if (!id) return fail("not_found");

  const unit = await prisma.product.findFirst({
    where: { id, customer: { deletedAt: null } },
    include: {
      customer: { select: { id: true, name: true } },
      reportUnits: {
        where: reportUnitWhere,
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          report: {
            select: {
              id: true,
              createdAt: true,
              workOrderId: true,
              template: { select: { title: true, fieldsJson: true } },
              workOrder: {
                select: { id: true, title: true, scheduledFor: true },
              },
            },
          },
        },
      },
      _count: {
        select: { reportUnits: { where: reportUnitWhere } },
      },
    },
  });
  if (!unit) return fail("not_found");

  return ok({ unit, canViewReports });
}

export type UnitDetailResult = Awaited<ReturnType<typeof getUnitDetail>>;
export type UnitDetailData = Extract<
  UnitDetailResult,
  { ok: true }
>["data"];

/** Valgene redigeringssiden trenger, i tillegg til selve kunden. */
export async function getCustomerEditOptions(
  actor: ServiceActor,
  customerId: string,
) {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
  });
  if (!customer) return fail("not_found");

  const [departments, technicians] = await Promise.all([
    prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ["ADMIN", "OFFICE", "TECHNICIAN"] },
      },
      orderBy: { name: "asc" },
      take: 100,
    }),
  ]);

  // Den ansvarlige montøren må være med i listen selv om vedkommende faller
  // utenfor det avgrensede utvalget.
  const technicianOptions = [...technicians];
  if (
    customer.responsibleTechnicianId &&
    !technicianOptions.some(
      (technician) => technician.id === customer.responsibleTechnicianId,
    )
  ) {
    const currentTechnician = await prisma.user.findUnique({
      where: { id: customer.responsibleTechnicianId },
    });
    if (currentTechnician) technicianOptions.unshift(currentTechnician);
  }

  return ok({ customer, departments, technicianOptions });
}

export type CustomerInput = {
  name?: unknown;
  orgNumber?: unknown;
  departmentId?: unknown;
  responsibleTechnicianId?: unknown;
};

/** Registrerer en ny kunde i katalogen. */
export async function createCustomer(
  actor: ServiceActor,
  input: CustomerInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const parsed = customerCreateSchema.safeParse({
    name: cleanText(input.name, { maxLength: LIMITS.title }),
    orgNumber: cleanText(input.orgNumber, { maxLength: LIMITS.line }),
    departmentId: cleanText(input.departmentId, { maxLength: LIMITS.line }),
    responsibleTechnicianId: cleanText(input.responsibleTechnicianId, {
      maxLength: LIMITS.line,
    }),
  });
  if (!parsed.success) return fail("invalid");
  const { name, orgNumber, departmentId, responsibleTechnicianId } =
    parsed.data;

  if (
    !(await validCustomerReferences(departmentId, responsibleTechnicianId))
  ) {
    return fail("invalid");
  }

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          name,
          orgNumber: orgNumber || null,
          departmentId: departmentId || null,
          responsibleTechnicianId: responsibleTechnicianId || null,
        },
      });
      await audit(tx, {
        entityType: "Customer",
        entityId: created.id,
        action: `Opprettet kunde: ${name}`,
        actor: toAuditActor(actor),
      });
      return created;
    });
    return ok({ id: customer.id });
  } catch (error) {
    console.error("Feil ved opprettelse av kunde:", error);
    return fail("error");
  }
}

export type CustomerUpdateInput = {
  name?: unknown;
  customerNumber?: unknown;
  orgNumber?: unknown;
  brandColor?: unknown;
  address?: unknown;
  postalCode?: unknown;
  city?: unknown;
  phone?: unknown;
  email?: unknown;
  notes?: unknown;
  departmentId?: unknown;
  responsibleTechnicianId?: unknown;
};

/** Oppdaterer kundekortet. */
export async function updateCustomer(
  actor: ServiceActor,
  customerId: string,
  input: CustomerUpdateInput,
): Promise<ServiceResult> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const parsed = customerUpdateSchema.safeParse({
    name: cleanText(input.name, { maxLength: LIMITS.title }),
    customerNumber: cleanText(input.customerNumber, {
      maxLength: LIMITS.line,
    }),
    orgNumber: cleanText(input.orgNumber, { maxLength: LIMITS.line }),
    brandColor: cleanText(input.brandColor, { maxLength: 20 }),
    address: cleanText(input.address, { maxLength: LIMITS.line }),
    postalCode: cleanText(input.postalCode, { maxLength: 20 }),
    city: cleanText(input.city, { maxLength: LIMITS.short }),
    phone: cleanPhone(input.phone),
    email: cleanEmail(input.email),
    notes: cleanMarkdown(input.notes),
    departmentId: cleanText(input.departmentId, { maxLength: LIMITS.line }),
    responsibleTechnicianId: cleanText(input.responsibleTechnicianId, {
      maxLength: LIMITS.line,
    }),
  });
  if (!parsed.success) return fail("invalid");

  const {
    name,
    customerNumber,
    orgNumber,
    brandColor,
    address,
    postalCode,
    city,
    phone,
    email,
    notes,
    departmentId,
    responsibleTechnicianId,
  } = parsed.data;

  if (
    !(await validCustomerReferences(departmentId, responsibleTechnicianId))
  ) {
    return fail("invalid");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          name,
          customerNumber: customerNumber || null,
          orgNumber: orgNumber || null,
          brandColor: brandColor || "#2563eb",
          address: address || null,
          postalCode: postalCode || null,
          city: city || null,
          phone: phone || null,
          email: email || null,
          notes: notes || null,
          departmentId: departmentId || null,
          responsibleTechnicianId: responsibleTechnicianId || null,
        },
      });
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Endret kundeinformasjon: ${name}`,
        actor: toAuditActor(actor),
      });
    });
    return ok(undefined);
  } catch (error) {
    console.error("Feil ved oppdatering av kunde:", error);
    return fail("error");
  }
}

// ---------------------------------------------------------------------------
// Kontaktpersoner
// ---------------------------------------------------------------------------

export type ContactCreateInput = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
};

export async function addContact(
  actor: ServiceActor,
  customerId: string,
  input: ContactCreateInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const parsed = contactCreateSchema.safeParse({
    name: cleanText(input.name, { maxLength: LIMITS.title }),
    email: cleanEmail(input.email),
    phone: cleanPhone(input.phone),
    role: cleanText(input.role, { maxLength: LIMITS.short }),
  });
  if (!parsed.success) return fail("invalid");
  const { name, email, phone, role } = parsed.data;

  try {
    const contact = await prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          name,
          email: email || null,
          phone: phone || null,
          role: role || null,
          customerId,
        },
      });
      // Kontaktpersonen er en del av kundekortet; kundens id er stabil.
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `La til kontaktperson: ${name}`,
        actor: toAuditActor(actor),
        metadata: { contactId: created.id },
      });
      return created;
    });
    return ok({ id: contact.id });
  } catch (error) {
    console.error("Feil ved opprettelse av kontaktperson:", error);
    return fail("error");
  }
}

export async function updateContact(
  actor: ServiceActor,
  customerId: string,
  input: ContactCreateInput & { id?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const parsed = contactUpdateSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    name: cleanText(input.name, { maxLength: LIMITS.title }),
    email: cleanEmail(input.email),
    phone: cleanPhone(input.phone),
    role: cleanText(input.role, { maxLength: LIMITS.short }),
  });
  if (!parsed.success) return fail("invalid");
  const { id, name, email, phone, role } = parsed.data;

  const existing = await prisma.contact.findFirst({
    where: { id, customerId },
    select: { id: true },
  });
  if (!existing) return fail("not_found");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id },
        data: {
          name,
          email: email || null,
          phone: phone || null,
          role: role || null,
        },
      });
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Endret kontaktperson: ${name}`,
        actor: toAuditActor(actor),
        metadata: { contactId: id },
      });
    });
    return ok(undefined);
  } catch (error) {
    console.error("Feil ved oppdatering av kontaktperson:", error);
    return fail("error");
  }
}

export async function deleteContact(
  actor: ServiceActor,
  customerId: string,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  try {
    const contact = await prisma.contact.findFirst({
      where: { id, customerId },
    });
    if (!contact) return fail("not_found");

    await prisma.$transaction(async (tx) => {
      // Kontakten kan være koblet til en kundeportalbruker. Relasjonen er
      // ON DELETE SET NULL, så brukeren ville ellers beholdt både kunde- og
      // innloggingstilgang etter at kontaktpersonen er fjernet. Deaktiver
      // brukeren og ugyldiggjør øktene før kontakten slettes.
      const portalUsers = await tx.user.updateMany({
        where: { contactId: id },
        data: {
          isActive: false,
          sessionVersion: { increment: 1 },
          calendarTokenHash: null,
          calendarTokenCreatedAt: null,
          calendarTokenLastUsedAt: null,
        },
      });

      await tx.contact.delete({ where: { id } });
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Slettet kontaktperson: ${contact.name || "Ukjent"}`,
        actor: toAuditActor(actor),
        metadata: {
          contactId: id,
          deactivatedPortalUsers: portalUsers.count,
        },
      });
    });
    return ok(undefined);
  } catch (error) {
    console.error("Feil ved sletting av kontaktperson:", error);
    return fail("error");
  }
}

// ---------------------------------------------------------------------------
// Enheter
// ---------------------------------------------------------------------------

export type UnitCreateInput = {
  customerId?: unknown;
  model?: unknown;
  serialNumber?: unknown;
  location?: unknown;
};

async function findUnitForCustomer(id: string, customerId: string) {
  if (!id || !customerId) return null;
  const unit = await prisma.product.findUnique({ where: { id } });
  if (!unit || unit.customerId !== customerId) return null;
  return unit;
}

export async function createUnit(
  actor: ServiceActor,
  input: UnitCreateInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "equipment.manage")) return fail("forbidden");

  const parsed = unitCreateSchema.safeParse({
    customerId: cleanText(input.customerId, { maxLength: LIMITS.line }),
    model: cleanText(input.model, { maxLength: LIMITS.title }),
    serialNumber: cleanText(input.serialNumber, { maxLength: LIMITS.line }),
    location: cleanText(input.location, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const { customerId, model, serialNumber, location } = parsed.data;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) return fail("not_found");

  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          customerId,
          model,
          serialNumber: serialNumber || null,
          location: location || null,
          qrToken: crypto.randomUUID().replace(/-/g, ""),
        },
      });
      // Enheten er en del av kundekortet, så hendelsen følger kundens id.
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `La til enhet: ${model}${serialNumber ? ` (SN: ${serialNumber})` : ""}`,
        actor: toAuditActor(actor),
        metadata: { productId: created.id },
      });
      return created;
    });
    return ok({ id: product.id });
  } catch (error) {
    console.error("Feil ved opprettelse av enhet:", error);
    return fail("error");
  }
}

export async function updateUnit(
  actor: ServiceActor,
  input: UnitCreateInput & { id?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "equipment.manage")) return fail("forbidden");

  const parsed = unitUpdateSchema.safeParse({
    customerId: cleanText(input.customerId, { maxLength: LIMITS.line }),
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    model: cleanText(input.model, { maxLength: LIMITS.title }),
    serialNumber: cleanText(input.serialNumber, { maxLength: LIMITS.line }),
    location: cleanText(input.location, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const { customerId, id, model, serialNumber, location } = parsed.data;

  const unit = await findUnitForCustomer(id, customerId);
  if (!unit) return fail("not_found");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          model,
          serialNumber: serialNumber || null,
          location: location || null,
        },
      });
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Oppdaterte enhet: ${model}${serialNumber ? ` (SN: ${serialNumber})` : ""}`,
        actor: toAuditActor(actor),
        metadata: { productId: id },
      });
    });
    return ok(undefined);
  } catch (error) {
    console.error("Feil ved oppdatering av enhet:", error);
    return fail("error");
  }
}

export async function deleteUnit(
  actor: ServiceActor,
  input: { customerId?: unknown; id?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const customerId = cleanText(input.customerId, { maxLength: LIMITS.line });
  const id = cleanText(input.id, { maxLength: LIMITS.line });
  if (!customerId || !id) return fail("invalid");

  const unit = await findUnitForCustomer(id, customerId);
  if (!unit) return fail("not_found");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.delete({ where: { id } });
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Slettet enhet: ${unit.model}${unit.serialNumber ? ` (SN: ${unit.serialNumber})` : ""}`,
        actor: toAuditActor(actor),
        metadata: { productId: id },
      });
    });
    return ok(undefined);
  } catch (error) {
    console.error("Feil ved sletting av enhet:", error);
    return fail("error");
  }
}

// ---------------------------------------------------------------------------
// Serviceavtaler
// ---------------------------------------------------------------------------

export type ContractCreateInput = {
  title?: unknown;
  startDate?: unknown;
  intervalMonths?: unknown;
  departmentId?: unknown;
  contactId?: unknown;
  templateId?: unknown;
};

export async function createContract(
  actor: ServiceActor,
  customerId: string,
  input: ContractCreateInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  // Administrator kan velge avdeling. Andre oppretter avtaler i egen avdeling.
  let departmentId: string | null = null;
  if (isAdminActor(actor)) {
    const requested = cleanText(input.departmentId, {
      maxLength: LIMITS.line,
    });
    if (requested) {
      const department = await prisma.department.findFirst({
        where: { id: requested, isActive: true },
        select: { id: true },
      });
      departmentId = department?.id ?? null;
    }
    departmentId = departmentId ?? (await getDefaultDepartmentId());
  } else {
    departmentId = actor.departmentId;
  }
  if (!departmentId) return fail("forbidden");

  const parsed = contractCreateSchema.safeParse({
    title: cleanText(input.title, { maxLength: LIMITS.title }),
    startDate: cleanText(input.startDate, { maxLength: LIMITS.line }),
    intervalMonths: cleanText(input.intervalMonths, {
      maxLength: LIMITS.short,
    }),
    departmentId,
    contactId: cleanText(input.contactId, { maxLength: LIMITS.line }),
    templateId: cleanText(input.templateId, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");

  const { title, contactId, templateId } = parsed.data;
  const startDate = parseDateOnly(parsed.data.startDate);
  const intervalMonths = parsed.data.intervalMonths;
  if (!startDate || !isContractInterval(intervalMonths)) return fail("invalid");

  const customerExists = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true },
  });
  if (!customerExists) return fail("not_found");

  // Kontaktpersonen og malen må faktisk finnes og høre til denne kunden.
  let validContactId: string | null = null;
  if (contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (contact?.customerId === customerId) validContactId = contactId;
  }

  let validTemplateId: string | null = null;
  if (templateId) {
    const template = await prisma.template.findUnique({
      where: { id: templateId },
      select: { id: true },
    });
    if (template) validTemplateId = templateId;
  }

  const nextServiceDate = firstOccurrenceOnOrAfter(
    startDate,
    intervalMonths,
    todayUtc(),
  );

  const contract = await prisma.$transaction(async (tx) => {
    const created = await tx.contract.create({
      data: {
        title,
        startDate,
        intervalMonths,
        nextServiceDate,
        isActive: true,
        customerId,
        departmentId,
        contactId: validContactId,
        templateId: validTemplateId,
      },
    });

    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `Opprettet serviceavtale: ${title} (${contractIntervalLabel(intervalMonths)})`,
      actor: toAuditActor(actor),
      metadata: { contractId: created.id },
    });

    return created;
  });

  // Starter avtalen i dag, skal første oppdrag lages med en gang. Ellers tar
  // bakgrunnsjobben det når neste service forfaller.
  if (nextServiceDate <= new Date()) {
    try {
      await generateRecurringWorkOrderForContract(contract.id);
    } catch (error) {
      console.error("Kunne ikke opprette første serviceavtale-oppdrag:", error);
    }
  }

  return ok({ id: contract.id });
}

export async function toggleContract(
  actor: ServiceActor,
  customerId: string,
  input: { id?: unknown; active?: unknown },
): Promise<ServiceResult> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const parsed = contractToggleSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    active: input.active,
  });
  if (!parsed.success) return fail("invalid");
  const { id, active } = parsed.data;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, customerId: true, departmentId: true, title: true },
  });
  if (!contract || contract.customerId !== customerId) return fail("not_found");
  if (!isAdminActor(actor) && contract.departmentId !== actor.departmentId) {
    return fail("forbidden");
  }

  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id },
      data: { isActive: active },
    });

    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `${active ? "Aktiverte" : "Pauset"} serviceavtale: ${contract.title}`,
      actor: toAuditActor(actor),
      metadata: { contractId: id },
    });
  });

  // Ved gjenaktivering kan neste service allerede ha forfalt. Da lages det
  // nyeste forfalte oppdraget med en gang i stedet for å vente på jobben.
  if (active) {
    try {
      await generateRecurringWorkOrderForContract(id);
    } catch (error) {
      console.error("Kunne ikke gjenoppta serviceavtale:", error);
    }
  }

  return ok(undefined);
}

export async function deleteContract(
  actor: ServiceActor,
  customerId: string,
  input: { id?: unknown },
): Promise<ServiceResult> {
  // Sletting er alltid forbeholdt administrator.
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const parsed = contractDeleteSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const id = parsed.data.id;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, customerId: true, title: true },
  });
  if (!contract || contract.customerId !== customerId) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.contract.delete({ where: { id } });

    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `Slettet serviceavtale: ${contract.title}`,
      actor: toAuditActor(actor),
      metadata: { contractId: id },
    });
  });

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Kundeverlegg
// ---------------------------------------------------------------------------

export type CustomerAttachmentInput = {
  customerId?: unknown;
  fileUrl?: unknown;
  fileName?: unknown;
  attachmentId?: unknown;
};

/** Knytter en opplastet fil til kundekortet. */
export async function addCustomerAttachment(
  actor: ServiceActor,
  input: CustomerAttachmentInput,
): Promise<ServiceResult> {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const customerId = cleanText(input.customerId, { maxLength: LIMITS.line });
  const fileUrl = cleanText(input.fileUrl, { maxLength: LIMITS.line });
  const fileName = cleanText(input.fileName, { maxLength: LIMITS.title });

  if (!customerId || !fileUrl) return fail("invalid");

  const filePath = attachmentPath(fileUrl);
  if (!filePath) return fail("invalid");

  try {
    await fs.access(filePath);
  } catch {
    return fail("file_not_found");
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, departmentId: true },
  });
  if (!customer) return fail("customer_not_found");

  const existing = await prisma.customerAttachment.findFirst({
    where: { customerId, dataUrl: fileUrl },
    select: { id: true },
  });
  if (existing) return ok(undefined);

  const displayName = fileName || "Vedlegg";

  // Eierskapet til filen, vedlegget og revisjonen avgjøres i én transaksjon.
  // En fil som allerede tilhører en annen kunde kan ikke flyttes over.
  const claimed = await prisma.$transaction(async (tx) => {
    const { claimed } = await claimUpload(tx, fileUrl, actor.id, {
      ownerType: "CUSTOMER",
      ownerId: customerId,
      departmentId: customer.departmentId,
      customerId,
    });
    if (!claimed) return false;

    const attachment = await tx.customerAttachment.create({
      data: { customerId, fileName: displayName, dataUrl: fileUrl },
    });

    await audit(tx, {
      entityType: "Customer",
      entityId: customerId,
      action: `La ved fil: ${displayName}`,
      actor: toAuditActor(actor),
      metadata: { attachmentId: attachment.id },
    });

    return true;
  });

  if (!claimed) return fail("invalid");

  return ok(undefined);
}

/** Fjerner et kundeverlegg. Sletting er forbeholdt administrator. */
export async function removeCustomerAttachment(
  actor: ServiceActor,
  input: { attachmentId?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const attachmentId = cleanText(input.attachmentId, {
    maxLength: LIMITS.line,
  });
  if (!attachmentId) return fail("invalid");

  const attachment = await prisma.customerAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!attachment) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.customerAttachment.delete({ where: { id: attachmentId } });

    await audit(tx, {
      entityType: "Customer",
      entityId: attachment.customerId,
      action: `Slettet vedlegg: ${attachment.fileName}`,
      actor: toAuditActor(actor),
      metadata: { attachmentId },
    });
  });

  await releaseUpload(attachment.dataUrl);

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Sletting og gjenoppretting
// ---------------------------------------------------------------------------

/**
 * Myksletter en kunde. Bare administrator kan slette. Kunden og alle
 * tilknyttede rader beholdes, slik at historikken kan gjenopprettes uten at
 * filer eller revisjoner går tapt.
 */
export async function deleteCustomer(
  actor: ServiceActor,
  customerId: string,
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const id = cleanText(customerId, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const customer = await prisma.customer.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!customer) return fail("not_found");

  const actorId = actor.id;

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customer.id },
      data: { deletedAt: new Date(), deletedBy: actor.name || actorId },
    });

    // En slettet kunde skal ikke lenger kunne bruke kundeportalen. Alle
    // portalbrukere knyttet til kunden deaktiveres, øktene deres ugyldiggjøres
    // og kalenderabonnementene fjernes. Gjenoppretting aktiverer dem bevisst
    // ikke igjen – en administrator må vurdere tilgangen på nytt.
    const portalUsers = await tx.user.updateMany({
      where: { customerId: customer.id, role: "CUSTOMER" },
      data: {
        isActive: false,
        sessionVersion: { increment: 1 },
        calendarTokenHash: null,
        calendarTokenCreatedAt: null,
        calendarTokenLastUsedAt: null,
      },
    });

    await audit(tx, {
      entityType: "Customer",
      entityId: customer.id,
      action: `Slettet kunden «${customer.name}» (myk sletting – kan gjenopprettes)`,
      actor: toAuditActor({ ...actor, id: actorId }),
      metadata: {
        softDeleted: true,
        deactivatedPortalUsers: portalUsers.count,
      },
    });
  });

  return ok(undefined);
}

/** Gjenoppretter en mykt slettet kunde. Bare administrator.
 *
 * Gjenopprettingen rører ikke kundeportalbrukerne: de ble deaktivert ved
 * sletting, og en administrator må aktivere hver bruker på nytt etter å ha
 * vurdert at tilgangen fortsatt er riktig. Da kan en gammel invitasjon eller
 * økt ikke gi tilbake tilgang uten en bevisst handling.
 */
export async function restoreCustomer(
  actor: ServiceActor,
  customerId: string,
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const id = cleanText(customerId, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!customer) return fail("not_found");
  if (!customer.deletedAt) return fail("invalid");

  const actorId = actor.id;

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customer.id },
      data: { deletedAt: null, deletedBy: null },
    });
    await audit(tx, {
      entityType: "Customer",
      entityId: customer.id,
      action: `Gjenopprettet kunden «${customer.name}»`,
      actor: toAuditActor({ ...actor, id: actorId }),
    });
  });

  return ok(undefined);
}
