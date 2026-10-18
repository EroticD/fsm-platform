import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";

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
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const customerId = formData.get("customerId") as string;
  const scheduledForStr = formData.get("scheduledFor") as string;
  const templateId = formData.get("templateId") as string;

  if (!title || !scheduledForStr) {
    return NextResponse.json({ error: "Manglende felt" }, { status: 400 });
  }

  const scheduledFor = new Date(scheduledForStr);

  const newWo = await prisma.workOrder.create({
    data: {
      title,
      description,
      customerId: customerId || undefined,
      scheduledFor,
      templates: templateId ? { connect: { id: templateId } } : undefined,
      creatorName: user.name || "Montør (Egenopprettet)",
      status: "PLANNED",
      technicians: {
        connect: { id: user.id }
      }
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
