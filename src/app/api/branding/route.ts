import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const branding = await prisma.branding.findFirst();
    return NextResponse.json({
      logoUrl: branding?.logoUrl || null,
      primaryColor: branding?.primaryColor || "#2563eb",
      companyName: branding?.companyName || "FSM System",
    });
  } catch (error) {
    return NextResponse.json({
      logoUrl: null,
      primaryColor: "#2563eb",
      companyName: "FSM System",
    });
  }
}
