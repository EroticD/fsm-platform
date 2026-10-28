import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { searchNormalizedIds } from "@/lib/search-sql";

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

  // Samme normaliserte søk som resten av kundeflatene: alle feltene på
  // kundekortet, tolerant for mellomrom/tegnsetting i telefon, org.nr og
  // kundenummer. Hjelperen returnerer bare id-er, så visningsfeltene hentes
  // eksplisitt og slettede kunder holdes ute.
  const hits = await searchNormalizedIds("Customer", q, MAX_RESULTS);
  const ids = hits.map((hit) => hit.id);

  const rows = ids.length === 0
    ? []
    : await prisma.customer.findMany({
        where: {
          deletedAt: null,
          id: { in: ids },
        },
        select: { id: true, name: true, city: true, customerNumber: true },
        take: MAX_RESULTS,
      });

  // Behold rekkefølgen fra søket (beste treff først), aldri flere enn taket, og
  // returner bare feltene kundevelgeren faktisk viser.
  const byId = new Map(rows.map((customer) => [customer.id, customer]));
  const customers = ids.flatMap((id) => {
    const customer = byId.get(id);
    return customer
      ? [
          {
            id: customer.id,
            name: customer.name,
            city: customer.city,
            customerNumber: customer.customerNumber,
          },
        ]
      : [];
  });

  return NextResponse.json({ customers });
}
