import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { performSearch } from "@/lib/search";

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!currentUser || !currentUser.isActive || currentUser.role === "CUSTOMER") {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const includeCancelled = currentUser.role === "ADMIN" || currentUser.role === "OFFICE";
  const results = await performSearch(q, { includeCancelled });
  return NextResponse.json(results);
}