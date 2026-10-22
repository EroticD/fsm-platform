import { NextResponse } from "next/server";
import { performSearch } from "@/lib/search";
import { getCurrentUser } from "@/lib/session";
import { allowRequest } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.isActive || currentUser.role === "CUSTOMER") {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  // Maks 120 søk per minutt per konto (hurtigsøket kaller dette ofte).
  const limit = allowRequest(`search:${currentUser.id}`, 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange søk. Prøv igjen om litt." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const includeCancelled = currentUser.role === "ADMIN" || currentUser.role === "OFFICE";
  const results = await performSearch(q, { user: currentUser, includeCancelled });
  return NextResponse.json(results);
}