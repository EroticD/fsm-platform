import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { parseDateOnly } from "@/lib/dates";

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session || !session.user?.email) {
    return NextResponse.redirect(new URL("/api/auth/signin", request.url));
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user || (user.role !== "TECHNICIAN" && user.role !== "ADMIN" && user.role !== "OFFICE")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const formData = await request.formData();
  const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
  const description = cleanMarkdown(formData.get("description"));
  const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
  const scheduledForStr = cleanText(formData.get("scheduledFor"), { maxLength: LIMITS.line });
  const scheduledToStr = cleanText(formData.get("scheduledTo"), { maxLength: LIMITS.line });
  const templateId = cleanText(formData.get("templateId"), { maxLength: LIMITS.line });
  const tagNames = formData.getAll("tags")
    .map(t => cleanText(t, { maxLength: LIMITS.short }))
    .filter(Boolean);

  const scheduledFor = parseDateOnly(scheduledForStr);
  const scheduledToDate = parseDateOnly(scheduledToStr);
  if (!title || !scheduledFor) {
    return NextResponse.json({ error: "Manglende felt" }, { status: 400 });
  }
  if (scheduledToDate && scheduledToDate < scheduledFor) {
    return NextResponse.json(
      { error: "Sluttdato kan ikke være før startdato" },
      { status: 400 }
    );
  }

  const newWo = await prisma.workOrder.create({
    data: {
      title,
      description,
      customerId: customerId || undefined,
      scheduledFor,
      scheduledTo:
        scheduledToDate && scheduledToDate > scheduledFor ? scheduledToDate : null,
      templates: templateId ? { connect: { id: templateId } } : undefined,
      creatorName: user.name || "Montør (Egenopprettet)",
      status: "PLANNED",
      technicians: {
        connect: { id: user.id }
      },
      tags: tagNames.length > 0 ? {
        connectOrCreate: tagNames.map(name => ({
          where: { name },
          create: { name }
        }))
      } : undefined
    }
  });

  await prisma.auditLog.create({
    data: {
      entityType: "WorkOrder",
      entityId: newWo.id,
      action: `Montør opprettet nytt oppdrag: ${title}`,
      userName: user.name || "Montør"
    }
  });

  return NextResponse.redirect(new URL("/mine-oppdrag", request.url), { status: 303 });
}
