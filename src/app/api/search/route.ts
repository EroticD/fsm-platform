import { NextResponse } from "next/server";
import { performSearch } from "@/lib/search";
import { getCurrentUser } from "@/lib/session";
import { allowRequestDb } from "@/lib/rate-limit-db";

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.isActive || currentUser.role === "CUSTOMER") {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  // Maks 60 søk per minutt per konto. Samme nøkkel som /sok, slik at de deler
  // kvoten, og telleren ligger i databasen for flere instanser.
  const limit = await allowRequestDb(`search:${currentUser.id}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange søk. Prøv igjen om litt." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const includeCancelled = currentUser.role === "ADMIN" || currentUser.role === "OFFICE";
  const results = await performSearch(q, { user: currentUser, includeCancelled });
  // Søkeresultatet er person- og kundedata som er avgrenset per bruker. Det
  // skal aldri mellomlagres i nettleser, proxy eller delt cache.
  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}