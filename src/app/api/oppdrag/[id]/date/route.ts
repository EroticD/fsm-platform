import { NextResponse } from "next/server";
import { WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseDateOnly, toDateOnly } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { workOrderDateSchema } from "@/lib/schemas/workOrder";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
  }

  if (!user.isActive || !hasPermission(user, "workorders.update")) {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
  }

  const parsed = workOrderDateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig dato" }, { status: 400 });
  }

  const scheduledFor = parseDateOnly(parsed.data.newDate);
  if (!scheduledFor) {
    return NextResponse.json({ error: "Dato mangler" }, { status: 400 });
  }

  // `newEnd` er siste inkluderte dag. Når den mangler eller er lik startdato,
  // lagres oppdraget som et éndagsoppdrag.
  const hasEnd = Object.prototype.hasOwnProperty.call(body, "newEnd");
  let scheduledTo: Date | null = null;

  if (parsed.data.newEnd) {
    const parsedEnd = parseDateOnly(parsed.data.newEnd);
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
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.workOrder.findFirst({
        where: {
          id,
          ...workOrderScope(user),
          ...(user.role === "TECHNICIAN"
            ? { status: { not: WorkStatus.CANCELLED } }
            : {}),
        },
        select: { id: true, scheduledFor: true, scheduledTo: true },
      });
      if (!before) return { count: 0 };

      const result = await tx.workOrder.updateMany({
        where: { id: before.id },
        data: hasEnd ? { scheduledFor, scheduledTo } : { scheduledFor },
      });

      if (result.count > 0) {
        await audit(tx, {
          entityType: "WorkOrder",
          entityId: before.id,
          action: `Endret dato til ${toDateOnly(scheduledFor)}${
            scheduledTo ? `–${toDateOnly(scheduledTo)}` : ""
          }`,
          actor: { id: user.id, name: user.name, email: user.email },
          metadata: {
            from: toDateOnly(before.scheduledFor),
            to: toDateOnly(scheduledTo ?? scheduledFor),
          },
        });
      }

      return result;
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Oppdraget finnes ikke" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Kunne ikke oppdatere dato" }, { status: 500 });
  }
}
