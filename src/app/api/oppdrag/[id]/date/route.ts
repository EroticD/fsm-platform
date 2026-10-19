import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { parseDateOnly } from "@/lib/dates";
import { isStaff } from "@/lib/session";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user?.isActive || !isStaff(user.role)) {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const newDate = cleanText(body.newDate, { maxLength: LIMITS.line });
  const scheduledFor = parseDateOnly(newDate);

  if (!scheduledFor) {
    return NextResponse.json({ error: "Dato mangler" }, { status: 400 });
  }

  // `newEnd` er siste inkluderte dag. Når den mangler eller er lik startdato,
  // lagres oppdraget som et éndagsoppdrag.
  const hasEnd = Object.prototype.hasOwnProperty.call(body, "newEnd");
  let scheduledTo: Date | null = null;

  if (hasEnd && body.newEnd) {
    const newEnd = cleanText(body.newEnd, { maxLength: LIMITS.line });
    const parsedEnd = parseDateOnly(newEnd);
    if (!parsedEnd) {
      return NextResponse.json({ error: "Ugyldig sluttdato" }, { status: 400 });
    }
    if (parsedEnd < scheduledFor) {
      return NextResponse.json(
        { error: "Sluttdato kan ikke være før startdato" },
        { status: 400 }
      );
    }
    scheduledTo = parsedEnd > scheduledFor ? parsedEnd : null;
  }

  try {
    await prisma.workOrder.update({
      where: { id },
      data: hasEnd ? { scheduledFor, scheduledTo } : { scheduledFor },
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Kunne ikke oppdatere dato" }, { status: 500 });
  }
}
