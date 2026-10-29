import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { FORM_BODY_LIMIT, readFormDataWithLimit } from "@/lib/request-body";
import { createWorkOrder as createWorkOrderService } from "@/server/work-orders";

/**
 * Teknikerens «nytt oppdrag»-skjema.
 *
 * Ruten går gjennom den samme tjenesten som kontorets skjema, slik at
 * autorisasjon, validering, avdelingsscope og revisjonslogg aldri kommer ut av
 * sync. Den har i tillegg en egen per-bruker rate limit.
 *
 * Alle feil sendes tilbake til skjemaet som en synlig `?error=`-melding. Vi
 * returnerer aldri rå JSON til en vanlig skjemainnsending – det ville etterlatt
 * montøren på en hvit side uten vei tilbake.
 */
function backToForm(request: Request, error: string) {
  return NextResponse.redirect(
    new URL(`/mine-oppdrag/ny?error=${encodeURIComponent(error)}`, request.url),
    { status: 303 },
  );
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return backToForm(request, "origin");
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/api/auth/signin", request.url));
  }
  if (!user.isActive || !hasPermission(user, "workorders.create")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (!user.departmentId) {
    return backToForm(request, "avdeling");
  }

  // Maks 10 nye oppdrag per minutt per bruker. Skjemaet brukes manuelt, så
  // grensen treffes bare ved hamring eller en kompromittert konto.
  const limit = await allowRequestDb(`workorder-create:${user.id}`, 10, 60_000);
  if (!limit.allowed) {
    return backToForm(request, "rate-limit");
  }

  const parsed = await readFormDataWithLimit(request, FORM_BODY_LIMIT);
  if (!parsed.ok) {
    // Skjemaet har ingen egen melding for 413, så store kropper behandles som
    // ugyldig data og brukeren sendes tilbake til skjemaet.
    return backToForm(request, "ugyldig-data");
  }

  const formData = parsed.data;
  const templateId = formData.get("templateId");

  const result = await createWorkOrderService(user, {
    title: formData.get("title"),
    description: formData.get("description"),
    address: formData.get("address"),
    postalCode: formData.get("postalCode"),
    city: formData.get("city"),
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
    if (result.error === "ikke-tilgang") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return backToForm(
      request,
      result.error === "avdeling" ||
        result.error === "duplikat-ordrenummer" ||
        result.error === "ugyldig-data"
        ? result.error
        : "ugyldig-data",
    );
  }

  return NextResponse.redirect(new URL("/mine-oppdrag", request.url), { status: 303 });
}
