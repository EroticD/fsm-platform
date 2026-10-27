import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { allowRequestDb } from "@/lib/rate-limit-db";

const MAX_RESULTS = 20;

/**
 * Serversøk i kunderegisteret for kundevalget i oppdragsskjemaet.
 * Skjemaet slipper dermed å laste de første 100 kundene og gjemme resten.
 */
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

  const limit = await allowRequestDb(`customer-search:${user.id}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange søk. Prøv igjen om litt." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (!q) return NextResponse.json({ customers: [] });

  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { customerNumber: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: MAX_RESULTS,
    select: { id: true, name: true, city: true, customerNumber: true },
  });

  return NextResponse.json({ customers });
}
