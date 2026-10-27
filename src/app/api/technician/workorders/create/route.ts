import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { createWorkOrder as createWorkOrderService } from "@/server/work-orders";

/**
 * Teknikerens «nytt oppdrag»-skjema.
 *
 * Ruten går gjennom den samme tjenesten som kontorets skjema, slik at
 * autorisasjon, validering, avdelingsscope og revisjonslogg aldri kommer ut av
 * sync. Den har i tillegg en egen per-bruker rate limit.
 */
export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.redirect(
      new URL("/mine-oppdrag/ny?error=origin", request.url),
      { status: 303 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/api/auth/signin", request.url));
  }
  if (!user.isActive || !hasPermission(user, "workorders.create")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (!user.departmentId) {
    return NextResponse.redirect(
      new URL("/mine-oppdrag/ny?error=avdeling", request.url),
      { status: 303 },
    );
  }

  // Maks 10 nye oppdrag per minutt per bruker. Skjemaet brukes manuelt, så
  // grensen treffes bare ved hamring eller en kompromittert konto.
  const limit = await allowRequestDb(`workorder-create:${user.id}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange forespørsler" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const formData = await request.formData();
  const templateId = formData.get("templateId");

  const result = await createWorkOrderService(user, {
    title: formData.get("title"),
    description: formData.get("description"),
    // Tjenesten bruker brukerens egen avdeling for ikke-administratorer.
    departmentId: user.departmentId,
    customerId: formData.get("customerId"),
    contactId: formData.get("contactId"),
    scheduledFor: formData.get("scheduledFor"),
    scheduledTo: formData.get("scheduledTo"),
    // Teknikeren oppretter oppdraget for seg selv.
    technicianIds: [user.id],
    templateIds: templateId ? [templateId] : [],
    tagNames: formData.getAll("tags"),
  });

  if (!result.ok) {
    if (result.error === "avdeling") {
      return NextResponse.redirect(
        new URL("/mine-oppdrag/ny?error=avdeling", request.url),
        { status: 303 },
      );
    }
    if (result.error === "ikke-tilgang") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.json({ error: "Manglende eller ugyldig data" }, { status: 400 });
  }

  return NextResponse.redirect(new URL("/mine-oppdrag", request.url), { status: 303 });
}
