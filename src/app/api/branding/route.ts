import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isSafeLogoUrl } from "@/lib/logo";

export async function GET() {
  try {
    const branding = await prisma.branding.findFirst();
    return NextResponse.json({
      // Bare opplastede logoer; eksterne URL-er kan peke på interne tjenere.
      logoUrl: isSafeLogoUrl(branding?.logoUrl) ? branding?.logoUrl : null,
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
