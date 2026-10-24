import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { csvCell } from "@/lib/csv";

/**
 * Eksporterer kundens egne oppdrag som CSV. Bare kundeportalbrukere med en
 * kundetilknytning får tilgang, og bare sine egne oppdrag.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isActive || user.role !== "CUSTOMER" || !user.customerId) {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  const workOrders = await prisma.workOrder.findMany({
    where: { customerId: user.customerId, deletedAt: null },
    orderBy: { scheduledFor: "desc" },
    select: {
      title: true,
      status: true,
      scheduledFor: true,
      scheduledTo: true,
      creatorName: true,
      contact: { select: { name: true } },
    },
  });

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
      "Content-Disposition": 'attachment; filename="mine-oppdrag.csv"',
      "Cache-Control": "no-store",
    },
  });
}
