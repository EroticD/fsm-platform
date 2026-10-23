import fs from "fs/promises";
import path from "path";
import { WorkStatus, type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
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
import { linkUploadOwner } from "@/lib/upload-access";
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

/** Bare filer som ligger i opplastingsmappen kan knyttes til en kunde. */
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

function attachmentPath(fileUrl: string): string | null {
  if (!UPLOAD_URL.test(fileUrl)) return null;
  return path.join(uploadDir(), path.basename(fileUrl));
}

const ACTIVE_STATUSES: WorkStatus[] = [
  WorkStatus.PLANNED,
  WorkStatus.IN_PROGRESS,
  WorkStatus.PENDING,
  WorkStatus.OPEN,
  WorkStatus.WAITING,
];

/** Kundekortet viser 25 oppdrag om gangen, ikke hele historikken. */
export const CUSTOMER_ORDER_PAGE_SIZE = 25;

/** Kunder katalogen viser per side. */
export const CUSTOMER_LIST_PAGE_SIZE = 25;

export type CustomerListParams = {
  search?: string;
  page: number;
};

/**
 * Kundekatalogen. Kunder er felles for alle avdelinger, men krever
 * `customers.view`.
 */
export async function getCustomerList(
  actor: ServiceActor,
  params: CustomerListParams,
) {
  if (!can(actor, "customers.view")) return fail("forbidden");

  const search = params.search?.trim() ?? "";
  const page = Math.max(1, params.page);
  const where: Prisma.CustomerWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { orgNumber: { contains: search, mode: "insensitive" } },
          { city: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { name: "asc" },
      take: CUSTOMER_LIST_PAGE_SIZE,
      skip: (page - 1) * CUSTOMER_LIST_PAGE_SIZE,
    }),
    prisma.customer.count({ where }),
  ]);

  return ok({
    customers,
    total,
    totalPages: Math.max(1, Math.ceil(total / CUSTOMER_LIST_PAGE_SIZE)),
  });
}

export type CustomerDetailParams = {
  tab: string;
  orderPage: number;
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
  const currentTab = params.tab;
  const orderPage = Math.max(1, params.orderPage);

  // Kunder, kontakter, enheter, avtaler, dokumenter og rapporter er felles for
  // alle avdelinger. Oppdragene på kundekortet er derimot avdelingssperret.
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
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

  const [customerAuditLogs, customerComments, portalUsers] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entityType: "Customer", entityId: customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.comment.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.user.findMany({
      where: { customerId, role: "CUSTOMER" },
      orderBy: { name: "asc" },
      include: { contact: true },
      take: 100,
    }),
  ]);

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

  // Enhetsfanen lastes først når den åpnes. Servicehistorikken per enhet er
  // begrenset til de 25 nyeste kontrollene; totalen kommer fra _count.
  const products =
    currentTab === "enheter"
      ? await prisma.product.findMany({
          where: { customerId },
          orderBy: { model: "asc" },
          take: 100,
          include: {
            reportUnits: {
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
            _count: { select: { reportUnits: true } },
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
    prisma.report.count({ where: { workOrder: orderWhere } }),
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
    recentLogs: customerAuditLogs.slice(0, 5),
  });
}

export type CustomerDetailResult = Awaited<
  ReturnType<typeof getCustomerDetail>
>;
export type CustomerDetailData = Extract<
  CustomerDetailResult,
  { ok: true }
>["data"];

/** Valgene redigeringssiden trenger, i tillegg til selve kunden. */
export async function getCustomerEditOptions(
  actor: ServiceActor,
  customerId: string,
) {
  if (!can(actor, "customers.manage")) return fail("forbidden");

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
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
  });
  if (!parsed.success) return fail("invalid");
  const { name, orgNumber } = parsed.data;

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: { name, orgNumber: orgNumber || null },
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
      await tx.contact.delete({ where: { id } });
      await audit(tx, {
        entityType: "Customer",
        entityId: customerId,
        action: `Slettet kontaktperson: ${contact.name || "Ukjent"}`,
        actor: toAuditActor(actor),
        metadata: { contactId: id },
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

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
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

  const customerExists = await prisma.customer.findUnique({
    where: { id: customerId },
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

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, departmentId: true },
  });
  if (!customer) return fail("customer_not_found");

  const existing = await prisma.customerAttachment.findFirst({
    where: { customerId, dataUrl: fileUrl },
    select: { id: true },
  });
  if (existing) return ok(undefined);

  const displayName = fileName || "Vedlegg";

  await prisma.$transaction(async (tx) => {
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
  });

  await linkUploadOwner(fileUrl, {
    ownerType: "CUSTOMER",
    ownerId: customerId,
    departmentId: customer.departmentId,
    customerId,
  });

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

    // Filen blir liggende på disk til en opprydningsjobb kan bekrefte at den
    // ikke er referert fra noe annet sted.
    await audit(tx, {
      entityType: "Customer",
      entityId: attachment.customerId,
      action: `Slettet vedlegg: ${attachment.fileName}`,
      actor: toAuditActor(actor),
      metadata: { attachmentId },
    });
  });

  return ok(undefined);
}
