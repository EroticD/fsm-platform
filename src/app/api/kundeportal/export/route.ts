import { NextResponse } from "next/server";
import { internalApiError } from "@/lib/api-errors";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { csvCell } from "@/lib/csv";
import { allowRequestDb } from "@/lib/rate-limit-db";

/** Maks antall rader i én eksport, slik at minnebruken er forutsigbar. */
const EXPORT_ROW_CAP = 5000;
/** Maks fem eksporter per bruker i timen. */
const EXPORT_RATE_LIMIT = 5;
const EXPORT_RATE_WINDOW_MS = 60 * 60_000;
/** Fast filnavn; selve innholdet er lokalisert via kundenes språk. */
const PORTAL_EXPORT_FILENAME = "mine-oppdrag.csv";

/**
 * Eksporterer kundens egne oppdrag som CSV. Bare kundeportalbrukere med en
 * kundetilknytning får tilgang, og bare sine egne oppdrag.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isActive || user.role !== "CUSTOMER" || !user.customerId) {
    return internalApiError("forbidden", 403);
  }

  // En mykt slettet kunde er stengt for kundeportalen, også direkte via en
  // gammel bokmerket eksportadresse.
  const customer = await prisma.customer.findFirst({
    where: { id: user.customerId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) {
    return internalApiError("forbidden", 403);
  }

  const limit = await allowRequestDb(
    `portal-export:${user.id}`,
    EXPORT_RATE_LIMIT,
    EXPORT_RATE_WINDOW_MS,
  );
  if (!limit.allowed) {
    return internalApiError("rate_limited", 429, {
      messageKey: "errors.api.export.rateLimited",
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const workOrders = await prisma.workOrder.findMany({
    where: { customerId: user.customerId, deletedAt: null },
    orderBy: { scheduledFor: "desc" },
    // Hent én ekstra rad for å oppdage at kunden har mer enn taket, uten å
    // laste hele historikken i minnet.
    take: EXPORT_ROW_CAP + 1,
    select: {
      title: true,
      status: true,
      scheduledFor: true,
      scheduledTo: true,
      creatorName: true,
      contact: { select: { name: true } },
    },
  });
  if (workOrders.length > EXPORT_ROW_CAP) {
    return internalApiError("export_too_large", 413, {
      messageKey: "errors.api.export.tooLarge",
    });
  }

  const header = ["Tittel", "Status", "Fra dato", "Til dato", "Booket av", "Kontaktperson"];
  const rows = workOrders.map((wo) =>
    [
      wo.title,
      wo.status,
      wo.scheduledFor ? new Date(wo.scheduledFor).toISOString().slice(0, 10) : "",
      wo.scheduledTo ? new Date(wo.scheduledTo).toISOString().slice(0, 10) : "",
      wo.creatorName ?? "",
      wo.contact?.name ?? "",
    ]
      .map(csvCell)
      .join(";"),
  );

  const csv = "\uFEFF" + [header.map(csvCell).join(";"), ...rows].join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${PORTAL_EXPORT_FILENAME}"`,
      "Cache-Control": "no-store",
    },
  });
}
