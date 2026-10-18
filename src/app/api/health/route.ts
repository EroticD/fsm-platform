import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Helsesjekk for Docker/orchestrator: svarer 200 bare hvis databasen er tilgjengelig.
// Ruten krever ikke innlogging, slik at containeren kan sjekke seg selv.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "up",
      time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Helsesjekk feilet:", error);
    return NextResponse.json({ status: "error", database: "down" }, { status: 503 });
  }
}
