import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { allowRequestDb } from "@/lib/rate-limit-db";

/** Kontaktene til én kunde, brukt når kunden er valgt i oppdragsskjemaet. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (
    !user ||
    !user.isActive ||
    user.role === "CUSTOMER" ||
    !(
      hasPermission(user, "workorders.create") ||
      hasPermission(user, "workorders.edit") ||
      hasPermission(user, "customers.view")
    )
  ) {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  const limit = await allowRequestDb(`customer-contacts:${user.id}`, 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange forespørsler. Prøv igjen om litt." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const customerId =
    new URL(request.url).searchParams.get("customerId")?.trim().slice(0, 64) ?? "";
  if (!customerId) return NextResponse.json({ contacts: [] });

  const contacts = await prisma.contact.findMany({
    where: { customerId, customer: { deletedAt: null } },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, role: true, customerId: true },
  });

  return NextResponse.json({ contacts });
}
