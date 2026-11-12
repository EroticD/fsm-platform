// i18n-ignore-file: tjenesten lagrer stabile norske revisjonsdata, ikke UI-tekst.
import type {
  Attachment,
  BookingRequest,
  BookingRequestEvent,
  Comment,
  Contact,
  Contract,
  Customer,
  CustomerAttachment,
  CustomerSite,
  Document,
  DocumentVersion,
  MaintenancePlan,
  Message,
  MessageThread,
  Product,
  Report,
  ReportDraft,
  ReportRevision,
  ReportUnit,
  Review,
  SmsMessage,
  Upload,
  User,
  WorkOrder,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { releaseUpload } from "@/lib/upload-cleanup";
import { deleteUploadFile } from "@/lib/uploads";
import { cleanText, LIMITS } from "@/lib/sanitize";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import { logServerError } from "@/lib/log-context";

/**
 * GDPR-sletting (DATA-01): anonymiserer kundens direkte identifikatorer uten å
 * slette tjenestehistorikken. Id-er, relasjoner, oppdrag, rapporter, revisjoner
 * og revisjonsloggen beholdes. Bevaringsplikt (legal hold) blokkerer hele
 * operasjonen før noe skrives.
 *
 * Retningslinjer:
 * - Kundekort, kontakter, steder og portalbrukere mister navn, e-post, telefon,
 *   adresse, org.nr og andre direkte identifikatorer.
 * - Oppdrag beholder tekniske data, datoer, status og referanse. Adresse,
 *   kontakt- og skapernavn fjernes, og kjente identifikatorer redigeres bort
 *   fra tittel/beskrivelse.
 * - Rapporter, revisjoner og enheter beholder svar og tjenestebevis. Kundenavn,
 *   kundesignatur og kvitteringsnavn fjernes. Kjente identifikatorer redigeres
 *   bort fra fritekst og JSON.
 * - Signerte rapport-PDF-er bevares uendret som tjenestebevis. Det er en
 *   bevisst, dokumentert begrensning; se docs/privacy-erasure.md.
 * - Kundens egne vedlegg, dokumentbibliotek og dokumentversjoner slettes sammen
 *   med filene. Oppdragsvedlegg og rapportbilder bevares som tjenestehistorikk.
 * - Revisjonsloggen endres aldri. Slettingen skriver en ny rad uten PII.
 */

const REDACTED = "[fjernet]";
const NEUTRAL_FILE_NAME = "anonymisert fil";
const ERASURE_ACTION =
  "Anonymiserte kundens direkte identifikatorer (personvernsletting)";
const UPLOAD_URL = /^\/uploads\/([A-Za-z0-9._-]+)$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JSON_UPLOAD = /\/uploads\/[A-Za-z0-9._-]+/g;

type ErasureDb = Pick<
  Prisma.TransactionClient,
  | "customer"
  | "contact"
  | "customerSite"
  | "portalDelegation"
  | "product"
  | "workOrder"
  | "report"
  | "reportRevision"
  | "reportUnit"
  | "reportDraft"
  | "customerAttachment"
  | "attachment"
  | "document"
  | "documentVersion"
  | "upload"
  | "comment"
  | "messageThread"
  | "message"
  | "smsMessage"
  | "bookingRequest"
  | "bookingRequestEvent"
  | "contract"
  | "review"
  | "maintenancePlan"
  | "user"
  | "auditHold"
  | "auditLog"
>;

export type CustomerErasureCounts = {
  contacts: number;
  sites: number;
  portalUsers: number;
  workOrders: number;
  reports: number;
  reportRevisions: number;
  reportUnits: number;
  reportDrafts: number;
  customerAttachments: number;
  workOrderAttachments: number;
  documents: number;
  documentVersions: number;
  uploads: number;
  comments: number;
  messageThreads: number;
  messages: number;
  smsMessages: number;
  bookingRequests: number;
  contracts: number;
  products: number;
  filesScheduledForDeletion: number;
  reportPdfsRetained: number;
  customerSignaturesRemoved: number;
};

export type ErasureBlockerKind =
  | "work_order_legal_hold"
  | "report_legal_hold"
  | "audit_hold";

export type ErasureBlocker = {
  kind: ErasureBlockerKind;
  entityType: string;
  entityId: string;
  /** Menneskelig referanse der det finnes (oppdragsreferanse, rapportnummer). */
  label?: string | null;
  /** Begrunnelse fra et AuditHold. Vises bare for administrator. */
  reason?: string | null;
};

export type CustomerErasurePreview = {
  customerId: string;
  /** Kundens nåværende navn. Brukes bare til å kreve skriftlig bekreftelse. */
  customerName: string;
  alreadyAnonymised: boolean;
  anonymisedAt: string | null;
  counts: CustomerErasureCounts;
  blockers: ErasureBlocker[];
};

export type CustomerErasureResult = {
  alreadyAnonymised: boolean;
  counts: CustomerErasureCounts;
  filesDeleted: number;
  fileDeletionFailures: number;
  reportPdfsRetained: number;
};

export type EraseCustomerInput = {
  reason: unknown;
  confirmation: unknown;
};

type ErasureData = {
  customer: Customer;
  contacts: Contact[];
  sites: CustomerSite[];
  products: Product[];
  workOrders: WorkOrder[];
  reports: Report[];
  reportRevisions: ReportRevision[];
  reportUnits: ReportUnit[];
  reportDrafts: ReportDraft[];
  customerAttachments: CustomerAttachment[];
  attachments: Attachment[];
  documents: Document[];
  documentVersions: DocumentVersion[];
  uploads: Upload[];
  comments: Comment[];
  messageThreads: MessageThread[];
  messages: Message[];
  smsMessages: SmsMessage[];
  bookingRequests: BookingRequest[];
  bookingRequestEvents: BookingRequestEvent[];
  contracts: Contract[];
  reviews: Review[];
  maintenancePlans: MaintenancePlan[];
  portalUsers: User[];
};

class ErasureBlockedError extends Error {
  blockers: ErasureBlocker[];

  constructor(blockers: ErasureBlocker[]) {
    super("customer erasure blocked");
    this.blockers = blockers;
  }
}

class ErasureNotFoundError extends Error {}

function shortId(id: string): string {
  return id.slice(-8);
}

export function neutralCustomerName(id: string): string {
  return `Anonymisert kunde ${shortId(id)}`;
}

export function neutralContactName(id: string): string {
  return `Anonymisert kontakt ${shortId(id)}`;
}

export function neutralSiteName(id: string): string {
  return `Anonymisert sted ${shortId(id)}`;
}

export function neutralPortalUserName(id: string): string {
  return `Anonymisert portalbruker ${shortId(id)}`;
}

export function emptyErasureCounts(): CustomerErasureCounts {
  return {
    contacts: 0,
    sites: 0,
    portalUsers: 0,
    workOrders: 0,
    reports: 0,
    reportRevisions: 0,
    reportUnits: 0,
    reportDrafts: 0,
    customerAttachments: 0,
    workOrderAttachments: 0,
    documents: 0,
    documentVersions: 0,
    uploads: 0,
    comments: 0,
    messageThreads: 0,
    messages: 0,
    smsMessages: 0,
    bookingRequests: 0,
    contracts: 0,
    products: 0,
    filesScheduledForDeletion: 0,
    reportPdfsRetained: 0,
    customerSignaturesRemoved: 0,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uploadStoredName(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = UPLOAD_URL.exec(url);
  return match ? match[1] : null;
}

function collectUploadNames(value: string | null | undefined, into: Set<string>): void {
  if (!value) return;
  for (const match of value.matchAll(JSON_UPLOAD)) {
    const stored = uploadStoredName(match[0]);
    if (stored) into.add(stored);
  }
}

/**
 * Alle kjente direkte identifikatorer for kunden. Listen brukes til å fjerne
 * identifikatorer fra fritekst og JSON uten å slette tjenestebeviset rundt.
 */
export function erasureIdentifiers(data: {
  customer: Customer;
  contacts: Contact[];
  sites: CustomerSite[];
  products?: Product[];
  workOrders?: WorkOrder[];
  bookingRequests?: BookingRequest[];
  documents?: Document[];
}): string[] {
  const values: Array<string | null | undefined> = [
    data.customer.name,
    data.customer.customerNumber,
    data.customer.orgNumber,
    data.customer.email,
    data.customer.phone,
    data.customer.address,
    data.customer.postalCode,
    data.customer.city,
  ];
  for (const contact of data.contacts) {
    values.push(contact.name, contact.email, contact.phone);
  }
  for (const site of data.sites) {
    values.push(site.name, site.address, site.postalCode, site.city);
  }
  for (const product of data.products ?? []) {
    values.push(product.location);
  }
  for (const order of data.workOrders ?? []) {
    values.push(order.address, order.postalCode, order.city);
  }
  for (const booking of data.bookingRequests ?? []) {
    values.push(
      booking.contactName,
      booking.contactPhone,
      booking.equipmentLabel,
    );
  }
  for (const document of data.documents ?? []) {
    values.push(document.title, document.fileName);
  }

  const seen = new Set<string>();
  const identifiers: string[] = [];
  for (const raw of values) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length < 3) continue;
    const key = value.toLocaleLowerCase("nb");
    if (seen.has(key)) continue;
    seen.add(key);
    identifiers.push(value);
  }
  identifiers.sort((a, b) => b.length - a.length);
  return identifiers;
}

/** Fjerner kjente identifikatorer og e-postadresser fra fritekst. */
export function redactErasureText(
  value: string | null | undefined,
  identifiers: readonly string[],
): string | null {
  if (value === null || value === undefined) return null;
  let out = value;
  for (const identifier of identifiers) {
    if (!identifier) continue;
    out = out.replace(new RegExp(escapeRegExp(identifier), "gi"), REDACTED);
  }
  return out.replace(EMAIL, REDACTED);
}

function scrubOrNull(
  value: string | null | undefined,
  identifiers: readonly string[],
): string | null {
  if (!value) return null;
  const redacted = redactErasureText(value, identifiers);
  if (!redacted || redacted === REDACTED) return null;
  return redacted;
}

const NULL_JSON_KEYS = new Set([
  "customername",
  "customersignatureurl",
  "customeracknowledgedby",
  "contactname",
  "contactphone",
]);

function redactJsonValue(
  value: unknown,
  identifiers: readonly string[],
): unknown {
  if (typeof value === "string") return redactErasureText(value, identifiers);
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item, identifiers));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLocaleLowerCase("en");
      if (NULL_JSON_KEYS.has(normalized)) {
        result[key] = null;
        continue;
      }
      result[key] = redactJsonValue(child, identifiers);
    }
    return result;
  }
  return value;
}

/**
 * Redigerer JSON uten å ødelegge strukturen. Ugyldig JSON behandles som tekst,
 * slik at en fremmed skrivemåte ikke kan omgå fjerningen.
 */
export function redactErasureJson(
  raw: string | null | undefined,
  identifiers: readonly string[],
): string | null {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(raw), identifiers));
  } catch {
    return redactErasureText(raw, identifiers);
  }
}

function parsePositiveId(value: unknown): string | null {
  const id = cleanText(value, { maxLength: LIMITS.line });
  return id || null;
}

function requireAdmin(actor: ServiceActor): ServiceResult<never> | null {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");
  // Administrator har alltid customers.manage, men kontrollen gjør regelen
  // eksplisitt dersom en fremtidig rollekonfigurasjon endrer det.
  if (!can(actor, "customers.manage")) return fail("forbidden");
  return null;
}

async function loadErasureData(
  db: ErasureDb,
  customerId: string,
): Promise<ErasureData | null> {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;

  const contacts = await db.contact.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
  });
  const sites = await db.customerSite.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
  });
  const products = await db.product.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
  });
  const workOrders = await db.workOrder.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
  });
  const workOrderIds = workOrders.map((row) => row.id);
  const productIds = products.map((row) => row.id);
  const contactIds = contacts.map((row) => row.id);

  const reports = workOrderIds.length
    ? await db.report.findMany({
        where: { workOrderId: { in: workOrderIds } },
        orderBy: { id: "asc" },
      })
    : [];
  const reportIds = reports.map((row) => row.id);

  const reportRevisions = reportIds.length
    ? await db.reportRevision.findMany({
        where: { reportId: { in: reportIds } },
        orderBy: { id: "asc" },
      })
    : [];
  const reportUnits = reportIds.length
    ? await db.reportUnit.findMany({
        where: { reportId: { in: reportIds } },
        orderBy: { id: "asc" },
      })
    : [];
  const reportDrafts = workOrderIds.length
    ? await db.reportDraft.findMany({
        where: { workOrderId: { in: workOrderIds } },
        orderBy: { id: "asc" },
      })
    : [];

  const customerAttachments = await db.customerAttachment.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
  });
  const attachments = workOrderIds.length
    ? await db.attachment.findMany({
        where: { workOrderId: { in: workOrderIds } },
        orderBy: { id: "asc" },
      })
    : [];

  const documents = await db.document.findMany({
    where: {
      OR: [
        { customerId },
        ...(productIds.length ? [{ productId: { in: productIds } }] : []),
      ],
    },
    orderBy: { id: "asc" },
  });
  const documentIds = documents.map((row) => row.id);
  const documentVersions = documentIds.length
    ? await db.documentVersion.findMany({
        where: { documentId: { in: documentIds } },
        orderBy: { id: "asc" },
      })
    : [];

  const contracts = await db.contract.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
  });
  const contractIds = contracts.map((row) => row.id);

  const portalUsers = await db.user.findMany({
    where: {
      role: "CUSTOMER",
      OR: [
        { customerId },
        ...(contactIds.length ? [{ contactId: { in: contactIds } }] : []),
      ],
    },
    orderBy: { id: "asc" },
  });

  const bookingRequests = await db.bookingRequest.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
  });
  const bookingIds = bookingRequests.map((row) => row.id);
  const bookingRequestEvents = bookingIds.length
    ? await db.bookingRequestEvent.findMany({
        where: { bookingRequestId: { in: bookingIds } },
        orderBy: { id: "asc" },
      })
    : [];

  const comments = await db.comment.findMany({
    where: {
      OR: [
        { customerId },
        ...(workOrderIds.length
          ? [{ workOrderId: { in: workOrderIds } }]
          : []),
      ],
    },
    orderBy: { id: "asc" },
  });

  const messageThreads = await db.messageThread.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
  });
  const threadIds = messageThreads.map((row) => row.id);
  const messages = threadIds.length
    ? await db.message.findMany({
        where: { threadId: { in: threadIds } },
        orderBy: { id: "asc" },
      })
    : [];
  const smsMessages = await db.smsMessage.findMany({
    where: {
      OR: [
        ...(threadIds.length ? [{ threadId: { in: threadIds } }] : []),
        ...(contactIds.length ? [{ contactId: { in: contactIds } }] : []),
        ...(workOrderIds.length
          ? [{ workOrderId: { in: workOrderIds } }]
          : []),
      ],
    },
    orderBy: { id: "asc" },
  });

  const reviews = workOrderIds.length
    ? await db.review.findMany({
        where: { workOrderId: { in: workOrderIds } },
        orderBy: { id: "asc" },
      })
    : [];
  const maintenancePlans = await db.maintenancePlan.findMany({
    where: { customerId },
    orderBy: { id: "asc" },
  });

  const storedNames = new Set<string>();
  for (const value of [
    customer.logoUrl,
    ...customerAttachments.map((row) => row.dataUrl),
    ...attachments.map((row) => row.dataUrl),
    ...documents.map((row) => row.filePath),
    ...documentVersions.map((row) => row.filePath),
    ...reports.flatMap((row) => [
      row.pdfUrl,
      row.technicianSignatureUrl,
      row.customerSignatureUrl,
    ]),
    ...reportRevisions.flatMap((row) => [
      row.technicianSignatureUrl,
      row.customerSignatureUrl,
      row.dataJson,
      row.unitsJson,
    ]),
    ...reportDrafts.map((row) => row.dataJson),
    ...reportUnits.map((row) => row.answersJson),
  ]) {
    const stored = uploadStoredName(value);
    if (stored) storedNames.add(stored);
    else collectUploadNames(value, storedNames);
  }

  const uploadOr: Prisma.UploadWhereInput[] = [
    { customerId },
    { ownerType: "CUSTOMER", ownerId: customerId },
    ...(workOrderIds.length
      ? [{ ownerType: "WORK_ORDER", ownerId: { in: workOrderIds } }]
      : []),
    ...(documentIds.length
      ? [{ ownerType: "DOCUMENT", ownerId: { in: documentIds } }]
      : []),
    ...(productIds.length
      ? [{ ownerType: "EQUIPMENT", ownerId: { in: productIds } }]
      : []),
    ...(contractIds.length
      ? [{ ownerType: "CONTRACT", ownerId: { in: contractIds } }]
      : []),
    ...(storedNames.size
      ? [{ storedName: { in: [...storedNames] } }]
      : []),
  ];
  const uploads = await db.upload.findMany({
    where: { OR: uploadOr },
    orderBy: { id: "asc" },
  });

  return {
    customer,
    contacts,
    sites,
    products,
    workOrders,
    reports,
    reportRevisions,
    reportUnits,
    reportDrafts,
    customerAttachments,
    attachments,
    documents,
    documentVersions,
    uploads,
    comments,
    messageThreads,
    messages,
    smsMessages,
    bookingRequests,
    bookingRequestEvents,
    contracts,
    reviews,
    maintenancePlans,
    portalUsers,
  };
}

function erasureCounts(data: ErasureData): CustomerErasureCounts {
  const customerSignaturesRemoved =
    data.reports.filter((row) => row.customerSignatureUrl).length +
    data.reportRevisions.filter((row) => row.customerSignatureUrl).length;
  return {
    contacts: data.contacts.length,
    sites: data.sites.length,
    portalUsers: data.portalUsers.length,
    workOrders: data.workOrders.length,
    reports: data.reports.length,
    reportRevisions: data.reportRevisions.length,
    reportUnits: data.reportUnits.length,
    reportDrafts: data.reportDrafts.length,
    customerAttachments: data.customerAttachments.length,
    workOrderAttachments: data.attachments.length,
    documents: data.documents.length,
    documentVersions: data.documentVersions.length,
    uploads: data.uploads.length,
    comments: data.comments.length,
    messageThreads: data.messageThreads.length,
    messages: data.messages.length,
    smsMessages: data.smsMessages.length,
    bookingRequests: data.bookingRequests.length,
    contracts: data.contracts.length,
    products: data.products.length,
    filesScheduledForDeletion:
      data.customerAttachments.length +
      data.attachments.length +
      data.documents.length +
      data.documentVersions.length +
      (data.customer.logoUrl ? 1 : 0) +
      customerSignaturesRemoved,
    reportPdfsRetained: data.reports.filter((row) => row.pdfUrl).length,
    customerSignaturesRemoved,
  };
}

function entityLabel(
  data: ErasureData,
  entityType: string,
  entityId: string,
): string | null {
  if (entityType === "WorkOrder") {
    return data.workOrders.find((row) => row.id === entityId)?.reference ?? null;
  }
  if (entityType === "Report") {
    return (
      data.reports.find((row) => row.id === entityId)?.reportNumber ?? null
    );
  }
  return null;
}

function activeAuditHoldBlockers(
  data: ErasureData,
  holds: Array<{
    id: string;
    auditLogId: string | null;
    entityType: string | null;
    entityId: string | null;
    reason: string;
  }>,
  heldLogs: Array<{ id: string; entityType: string; entityId: string }>,
): ErasureBlocker[] {
  const pairs = new Set<string>();
  const add = (entityType: string, entityId: string) => {
    if (entityId) pairs.add(`${entityType}\u0000${entityId}`);
  };

  add("Customer", data.customer.id);
  for (const row of data.contacts) add("Contact", row.id);
  for (const row of data.sites) add("CustomerSite", row.id);
  for (const row of data.products) add("Product", row.id);
  for (const row of data.workOrders) add("WorkOrder", row.id);
  for (const row of data.reports) add("Report", row.id);
  for (const row of data.reportRevisions) add("ReportRevision", row.id);
  for (const row of data.reportUnits) add("ReportUnit", row.id);
  for (const row of data.reportDrafts) add("ReportDraft", row.id);
  for (const row of data.customerAttachments) add("CustomerAttachment", row.id);
  for (const row of data.attachments) add("Attachment", row.id);
  for (const row of data.documents) add("Document", row.id);
  for (const row of data.documentVersions) add("DocumentVersion", row.id);
  for (const row of data.uploads) add("Upload", row.id);
  for (const row of data.comments) add("Comment", row.id);
  for (const row of data.messageThreads) add("MessageThread", row.id);
  for (const row of data.messages) add("Message", row.id);
  for (const row of data.smsMessages) add("SmsMessage", row.id);
  for (const row of data.bookingRequests) add("BookingRequest", row.id);
  for (const row of data.bookingRequestEvents) add("BookingRequestEvent", row.id);
  for (const row of data.contracts) add("Contract", row.id);
  for (const row of data.reviews) add("Review", row.id);
  for (const row of data.maintenancePlans) add("MaintenancePlan", row.id);
  for (const row of data.portalUsers) add("User", row.id);

  const logById = new Map(heldLogs.map((row) => [row.id, row]));
  const blockers: ErasureBlocker[] = [];
  for (const hold of holds) {
    if (hold.auditLogId) {
      const log = logById.get(hold.auditLogId);
      if (!log || !pairs.has(`${log.entityType}\u0000${log.entityId}`)) {
        continue;
      }
      blockers.push({
        kind: "audit_hold",
        entityType: log.entityType,
        entityId: log.entityId,
        reason: hold.reason,
      });
      continue;
    }
    if (!hold.entityType || !hold.entityId) continue;
    if (!pairs.has(`${hold.entityType}\u0000${hold.entityId}`)) continue;
    blockers.push({
      kind: "audit_hold",
      entityType: hold.entityType,
      entityId: hold.entityId,
      label: entityLabel(data, hold.entityType, hold.entityId),
      reason: hold.reason,
    });
  }
  return blockers;
}

async function collectBlockers(
  db: ErasureDb,
  data: ErasureData,
): Promise<ErasureBlocker[]> {
  const blockers: ErasureBlocker[] = [];
  for (const order of data.workOrders) {
    if (order.legalHold) {
      blockers.push({
        kind: "work_order_legal_hold",
        entityType: "WorkOrder",
        entityId: order.id,
        label: order.reference,
      });
    }
  }
  for (const report of data.reports) {
    if (report.legalHold) {
      blockers.push({
        kind: "report_legal_hold",
        entityType: "Report",
        entityId: report.id,
        label: report.reportNumber,
      });
    }
  }

  const holds = await db.auditHold.findMany({
    where: { releasedAt: null },
    select: {
      id: true,
      auditLogId: true,
      entityType: true,
      entityId: true,
      reason: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const logIds = holds
    .map((hold) => hold.auditLogId)
    .filter((value): value is string => Boolean(value));
  const heldLogs = logIds.length
    ? await db.auditLog.findMany({
        where: { id: { in: logIds } },
        select: { id: true, entityType: true, entityId: true },
      })
    : [];
  blockers.push(...activeAuditHoldBlockers(data, holds, heldLogs));

  const kindOrder: Record<ErasureBlockerKind, number> = {
    work_order_legal_hold: 0,
    report_legal_hold: 1,
    audit_hold: 2,
  };
  return blockers.sort((a, b) => {
    const kind = kindOrder[a.kind] - kindOrder[b.kind];
    return kind !== 0 ? kind : a.entityId.localeCompare(b.entityId);
  });
}

/** Leser forhåndsvisningen uten å skrive noe. Bare aktiv administrator. */
export async function getCustomerErasurePreview(
  actor: ServiceActor,
  customerId: string,
): Promise<ServiceResult<CustomerErasurePreview>> {
  const denied = requireAdmin(actor);
  if (denied) return denied;

  const id = parsePositiveId(customerId);
  if (!id) return fail("invalid");

  const data = await loadErasureData(prisma, id);
  if (!data) return fail("not_found");

  const blockers = await collectBlockers(prisma, data);
  return ok({
    customerId: data.customer.id,
    customerName: data.customer.name,
    alreadyAnonymised: Boolean(data.customer.anonymisedAt),
    anonymisedAt: data.customer.anonymisedAt?.toISOString() ?? null,
    counts: erasureCounts(data),
    blockers,
  });
}

type ApplyResult = {
  alreadyAnonymised: boolean;
  counts: CustomerErasureCounts;
  reportPdfsRetained: number;
  uploadUrls: string[];
  safeFileNames: string[];
};

async function applyErasure(
  tx: Prisma.TransactionClient,
  data: ErasureData,
  actor: ServiceActor,
  reason: string,
): Promise<ApplyResult> {
  const now = new Date();
  const customer = data.customer;
  const contactIds = data.contacts.map((row) => row.id);
  const workOrderIds = data.workOrders.map((row) => row.id);
  const documentIds = data.documents.map((row) => row.id);
  const portalUserIds = data.portalUsers.map((row) => row.id);
  const identifiers = erasureIdentifiers(data);
  const redactedReason =
    scrubOrNull(reason, identifiers)?.slice(0, 500) ?? "Personvernering";

  await tx.customer.update({
    where: { id: customer.id },
    data: {
      name: neutralCustomerName(customer.id),
      customerNumber: null,
      orgNumber: null,
      brandColor: null,
      logoUrl: null,
      address: null,
      postalCode: null,
      city: null,
      phone: null,
      email: null,
      notes: null,
      responsibleTechnicianId: null,
      anonymisedAt: now,
      anonymisedBy: actor.id,
    },
  });

  for (const contact of data.contacts) {
    await tx.contact.update({
      where: { id: contact.id },
      data: {
        name: neutralContactName(contact.id),
        email: null,
        phone: null,
        role: scrubOrNull(contact.role, identifiers),
      },
    });
  }
  if (contactIds.length) {
    await tx.portalDelegation.updateMany({
      where: { contactId: { in: contactIds } },
      data: {
        isActive: false,
        canBook: false,
        canViewDocuments: false,
        canViewContracts: false,
        canViewEquipment: false,
      },
    });
  }

  // Portalbrukere stenges helt: deaktivert konto, ingen e-post/passord,
  // ugyldiggjort økt og slettede innloggingsartefakter. Raden beholdes fordi
  // bestillinger, meldinger og revisjonslogger kan peke på bruker-id-en.
  for (const user of data.portalUsers) {
    await tx.user.update({
      where: { id: user.id },
      data: {
        name: neutralPortalUserName(user.id),
        email: null,
        phone: null,
        image: null,
        emailVerified: null,
        password: null,
        resetToken: null,
        resetTokenExpiry: null,
        isTwoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorSetupStartedAt: null,
        lastTotpTimeStep: null,
        isActive: false,
        sessionVersion: { increment: 1 },
        calendarTokenHash: null,
        calendarTokenCreatedAt: null,
        calendarTokenLastUsedAt: null,
      },
    });
  }
  if (portalUserIds.length) {
    await tx.twoFactorRecoveryCode.deleteMany({
      where: { userId: { in: portalUserIds } },
    });
    await tx.ssoIdentity.deleteMany({
      where: { userId: { in: portalUserIds } },
    });
    await tx.apiKey.deleteMany({ where: { userId: { in: portalUserIds } } });
    await tx.notification.deleteMany({
      where: { userId: { in: portalUserIds } },
    });
    await tx.notificationPreference.deleteMany({
      where: { userId: { in: portalUserIds } },
    });
    await tx.savedSearch.deleteMany({
      where: { userId: { in: portalUserIds } },
    });
  }

  for (const site of data.sites) {
    await tx.customerSite.update({
      where: { id: site.id },
      data: {
        name: neutralSiteName(site.id),
        address: null,
        postalCode: null,
        city: null,
        latitude: null,
        longitude: null,
      },
    });
  }

  for (const product of data.products) {
    await tx.product.update({
      where: { id: product.id },
      data: {
        location: scrubOrNull(product.location, identifiers),
      },
    });
  }

  for (const order of data.workOrders) {
    await tx.workOrder.update({
      where: { id: order.id },
      data: {
        title: redactErasureText(order.title, identifiers) ?? order.title,
        description: scrubOrNull(order.description, identifiers),
        address: null,
        postalCode: null,
        city: null,
        latitude: null,
        longitude: null,
        geoAddressHash: null,
        creatorName: scrubOrNull(order.creatorName, identifiers),
        orderNumber: null,
        orderNumberNormalized: null,
      },
    });
  }

  for (const booking of data.bookingRequests) {
    await tx.bookingRequest.update({
      where: { id: booking.id },
      data: {
        contactName: neutralContactName(booking.id),
        contactPhone: REDACTED,
        equipmentLabel: scrubOrNull(booking.equipmentLabel, identifiers),
      },
    });
  }
  for (const event of data.bookingRequestEvents) {
    await tx.bookingRequestEvent.update({
      where: { id: event.id },
      data: {
        actorName: scrubOrNull(event.actorName, identifiers),
        message: scrubOrNull(event.message, identifiers),
      },
    });
  }

  for (const comment of data.comments) {
    await tx.comment.update({
      where: { id: comment.id },
      data: {
        content: redactErasureText(comment.content, identifiers) ?? comment.content,
        authorName: scrubOrNull(comment.authorName, identifiers),
      },
    });
  }

  for (const thread of data.messageThreads) {
    await tx.messageThread.update({
      where: { id: thread.id },
      data: { subject: scrubOrNull(thread.subject, identifiers) },
    });
  }
  for (const message of data.messages) {
    await tx.message.update({
      where: { id: message.id },
      data: {
        body: redactErasureText(message.body, identifiers) ?? message.body,
        fromAddress: null,
        toAddress: null,
      },
    });
  }
  for (const sms of data.smsMessages) {
    await tx.smsMessage.update({
      where: { id: sms.id },
      data: {
        to: REDACTED,
        from: null,
        body: redactErasureText(sms.body, identifiers) ?? sms.body,
        lastError: scrubOrNull(sms.lastError, identifiers),
      },
    });
  }

  for (const contract of data.contracts) {
    await tx.contract.update({
      where: { id: contract.id },
      data: {
        title: redactErasureText(contract.title, identifiers) ?? contract.title,
        contractNumber: scrubOrNull(contract.contractNumber, identifiers),
      },
    });
  }
  for (const plan of data.maintenancePlans) {
    await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: {
        title: redactErasureText(plan.title, identifiers) ?? plan.title,
      },
    });
  }
  for (const review of data.reviews) {
    if (review.comment === null) continue;
    await tx.review.update({
      where: { id: review.id },
      data: { comment: scrubOrNull(review.comment, identifiers) },
    });
  }

  // Rapporter er tjenestebevis. Svar, status, revisjoner og signerte PDF-er
  // beholdes; bare kundens direkte identifikatorer og kundesignatur fjernes.
  for (const report of data.reports) {
    await tx.report.update({
      where: { id: report.id },
      data: {
        dataJson: redactErasureJson(report.dataJson, identifiers) ?? "{}",
        comments: scrubOrNull(report.comments, identifiers),
        customerName: null,
        customerSignatureUrl: null,
        customerAcknowledgedBy: null,
        customerAcknowledgedComment: scrubOrNull(
          report.customerAcknowledgedComment,
          identifiers,
        ),
        customerDataRedactedAt: now,
      },
    });
  }
  for (const revision of data.reportRevisions) {
    await tx.reportRevision.update({
      where: { id: revision.id },
      data: {
        dataJson: redactErasureJson(revision.dataJson, identifiers) ?? "{}",
        unitsJson: redactErasureJson(revision.unitsJson, identifiers) ?? "[]",
        comments: scrubOrNull(revision.comments, identifiers),
        customerName: null,
        customerSignatureUrl: null,
        customerAcknowledgedBy: null,
        customerAcknowledgedComment: scrubOrNull(
          revision.customerAcknowledgedComment,
          identifiers,
        ),
      },
    });
  }
  for (const unit of data.reportUnits) {
    await tx.reportUnit.update({
      where: { id: unit.id },
      data: {
        label: redactErasureText(unit.label, identifiers) ?? unit.label,
        location: scrubOrNull(unit.location, identifiers),
        comment: scrubOrNull(unit.comment, identifiers),
        answersJson: redactErasureJson(unit.answersJson, identifiers) ?? "{}",
      },
    });
  }

  // Kladder er midlertidige og kan inneholde navn, notater og signaturbilder.
  if (workOrderIds.length) {
    await tx.reportDraft.deleteMany({
      where: { workOrderId: { in: workOrderIds } },
    });
  }

  // Kundens egne filer og dokumentbibliotek slettes. Oppdragsvedlegg slettes
  // også; rapportbilder og signerte rapport-PDF-er bevares som tjenestebevis.
  if (data.customerAttachments.length) {
    await tx.customerAttachment.deleteMany({
      where: { id: { in: data.customerAttachments.map((row) => row.id) } },
    });
  }
  if (data.attachments.length) {
    await tx.attachment.deleteMany({
      where: { id: { in: data.attachments.map((row) => row.id) } },
    });
  }
  if (documentIds.length) {
    await tx.document.deleteMany({ where: { id: { in: documentIds } } });
  }

  // Bevarte filer (rapport-PDF-er, bilder og tekniske vedlegg) skal ikke
  // fortsette å bære kundens opprinnelige filnavn i metadata.
  if (data.uploads.length) {
    await tx.upload.updateMany({
      where: { id: { in: data.uploads.map((row) => row.id) } },
      data: { originalName: NEUTRAL_FILE_NAME },
    });
  }

  const counts = erasureCounts(data);
  await audit(tx, {
    entityType: "Customer",
    entityId: customer.id,
    action: ERASURE_ACTION,
    actor: toAuditActor(actor),
    departmentId: customer.departmentId,
    metadata: {
      operation: "customer_erasure",
      reason: redactedReason,
      anonymisedAt: now.toISOString(),
      counts: {
        contacts: counts.contacts,
        sites: counts.sites,
        portalUsers: counts.portalUsers,
        workOrders: counts.workOrders,
        reports: counts.reports,
        reportRevisions: counts.reportRevisions,
        reportUnits: counts.reportUnits,
        reportDrafts: counts.reportDrafts,
        customerAttachments: counts.customerAttachments,
        workOrderAttachments: counts.workOrderAttachments,
        documents: counts.documents,
        documentVersions: counts.documentVersions,
        uploads: counts.uploads,
        comments: counts.comments,
        messages: counts.messages,
        smsMessages: counts.smsMessages,
        bookingRequests: counts.bookingRequests,
        contracts: counts.contracts,
        products: counts.products,
      },
      preserved: {
        workOrders: counts.workOrders,
        reports: counts.reports,
        reportRevisions: counts.reportRevisions,
        reportPdfs: counts.reportPdfsRetained,
      },
      filesScheduledForDeletion: counts.filesScheduledForDeletion,
      customerSignaturesRemoved: counts.customerSignaturesRemoved,
    },
  });

  const uploadUrls = data.uploads.map((row) => `/uploads/${row.storedName}`);
  const safeFileNames = [
    ...data.customerAttachments.map((row) => uploadStoredName(row.dataUrl)),
    ...data.attachments.map((row) => uploadStoredName(row.dataUrl)),
    ...data.documents.map((row) => uploadStoredName(row.filePath)),
    ...data.documentVersions.map((row) => uploadStoredName(row.filePath)),
    uploadStoredName(customer.logoUrl),
  ].filter((value): value is string => Boolean(value));

  return {
    alreadyAnonymised: false,
    counts,
    reportPdfsRetained: counts.reportPdfsRetained,
    uploadUrls,
    safeFileNames,
  };
}

async function cleanupFiles(result: ApplyResult): Promise<{
  deleted: number;
  failures: number;
}> {
  let deleted = 0;
  let failures = 0;
  const deletedNames = new Set<string>();

  for (const url of result.uploadUrls) {
    const stored = uploadStoredName(url);
    try {
      const removed = await releaseUpload(url);
      if (removed && stored) {
        deletedNames.add(stored);
        deleted += 1;
      }
    } catch (error) {
      failures += 1;
      await logServerError("Kunne ikke rydde opplastet fil etter sletting", error, {
        fileUrl: url,
      });
    }
  }

  // Filer uten Upload-metadata (eldre data) ryddes direkte. Bare filer som
  // hørte til slettede kunde-/oppdragsvedlegg eller dokumenter havner her –
  // aldri rapport-PDF-er eller signaturer som kan være delt.
  for (const stored of result.safeFileNames) {
    if (deletedNames.has(stored)) continue;
    // Har filen fortsatt en Upload-rad, er den beholdt fordi noe annet
    // refererer til den (for eksempel en rapport-PDF eller et delt bilde).
    // Da skal den ikke røres, selv om den også lå i en slettet vedleggsrad.
    const stillRegistered = await prisma.upload.findUnique({
      where: { storedName: stored },
      select: { id: true },
    });
    if (stillRegistered) continue;
    try {
      await deleteUploadFile(stored);
      deletedNames.add(stored);
      deleted += 1;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        failures += 1;
        await logServerError("Kunne ikke slette fil etter sletting", error, {
          storedName: stored,
        });
      }
    }
  }

  return { deleted, failures };
}

/**
 * Sletter/anonymiserer kundens direkte identifikatorer. Krever aktiv
 * administrator og skriftlig bekreftelse på kundens nåværende navn.
 *
 * Hele databaseskrivingen skjer i én transaksjon. Bevaringsplikt kontrolleres
 * på nytt inne i transaksjonen, så en samtidig legal hold ikke kan gi delvise
 * skrivinger. Filer ryddes etter commit; en fil som ikke kan slettes telles og
 * logges, men databasesaneringen rulles ikke tilbake for den.
 */
export async function eraseCustomerData(
  actor: ServiceActor,
  customerId: string,
  input: EraseCustomerInput,
): Promise<ServiceResult<CustomerErasureResult>> {
  const denied = requireAdmin(actor);
  if (denied) return denied;

  const id = parsePositiveId(customerId);
  if (!id) return fail("invalid");

  const current = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, name: true, anonymisedAt: true },
  });
  if (!current) return fail("not_found");
  if (current.anonymisedAt) {
    return ok({
      alreadyAnonymised: true,
      counts: emptyErasureCounts(),
      filesDeleted: 0,
      fileDeletionFailures: 0,
      reportPdfsRetained: 0,
    });
  }

  const reason = cleanText(input.reason, { maxLength: 500 });
  if (reason.length < 3) return fail("invalid", { field: "reason" });
  const confirmation = cleanText(input.confirmation, {
    maxLength: LIMITS.title,
  });
  if (confirmation !== current.name.trim()) {
    return fail("invalid", { field: "confirmation" });
  }

  let applied: ApplyResult;
  try {
    applied = await prisma.$transaction(async (tx) => {
      const data = await loadErasureData(tx, id);
      if (!data) throw new ErasureNotFoundError();
      if (data.customer.anonymisedAt) {
        return {
          alreadyAnonymised: true,
          counts: emptyErasureCounts(),
          reportPdfsRetained: 0,
          uploadUrls: [],
          safeFileNames: [],
        };
      }
      const blockers = await collectBlockers(tx, data);
      if (blockers.length > 0) throw new ErasureBlockedError(blockers);
      return applyErasure(tx, data, actor, reason);
    });
  } catch (error) {
    if (error instanceof ErasureBlockedError) {
      return fail("conflict", { blockers: error.blockers });
    }
    if (error instanceof ErasureNotFoundError) return fail("not_found");
    throw error;
  }

  if (applied.alreadyAnonymised) {
    return ok({
      alreadyAnonymised: true,
      counts: emptyErasureCounts(),
      filesDeleted: 0,
      fileDeletionFailures: 0,
      reportPdfsRetained: 0,
    });
  }

  const cleanup = await cleanupFiles(applied);
  return ok({
    alreadyAnonymised: false,
    counts: applied.counts,
    filesDeleted: cleanup.deleted,
    fileDeletionFailures: cleanup.failures,
    reportPdfsRetained: applied.reportPdfsRetained,
  });
}

export function erasureBlockersFromDetails(details: unknown): ErasureBlocker[] {
  if (!details || typeof details !== "object") return [];
  const blockers = (details as { blockers?: unknown }).blockers;
  return Array.isArray(blockers) ? (blockers as ErasureBlocker[]) : [];
}
