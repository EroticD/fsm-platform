import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";

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
  const { newDate } = body;

  if (!newDate) {
    return NextResponse.json({ error: "Dato mangler" }, { status: 400 });
  }

  try {
    await prisma.workOrder.update({
      where: { id },
      data: { scheduledFor: new Date(newDate) },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Kunne ikke oppdatere dato" }, { status: 500 });
  }
}
