import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { LIMITS, cleanText } from "@/lib/sanitize";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const newDate = cleanText(body.newDate, { maxLength: LIMITS.line });

  const scheduledFor = newDate ? new Date(newDate) : null;
  if (!scheduledFor || Number.isNaN(scheduledFor.getTime())) {
    return NextResponse.json({ error: "Dato mangler" }, { status: 400 });
  }

  try {
    await prisma.workOrder.update({
      where: { id },
      data: { scheduledFor },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Kunne ikke oppdatere dato" }, { status: 500 });
  }
}
