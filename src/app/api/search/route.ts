import { NextResponse } from "next/server";
import { performSearch } from "@/lib/search";
import { getCurrentUser } from "@/lib/session";

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.isActive || currentUser.role === "CUSTOMER") {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const includeCancelled = currentUser.role === "ADMIN" || currentUser.role === "OFFICE";
  const results = await performSearch(q, { user: currentUser, includeCancelled });
  return NextResponse.json(results);
}