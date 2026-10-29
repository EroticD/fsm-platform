import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/origin";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { updateWorkOrderDate } from "@/server/work-orders";

/**
 * Flytter et oppdrag i kalenderen. All validering, autorisasjon og logging
 * ligger i `updateWorkOrderDate`; ruten oversetter bare resultatet til HTTP.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "Ugyldig origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
  }

  if (!user.isActive || !hasPermission(user, "workorders.update")) {
    return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
  }

  // Maks 30 datoflyttinger per minutt per konto. Grensen ligger før kroppen
  // leses, slik at en misbrukt konto ikke kan bruke parsing som DoS-vektor.
  const limit = await allowRequestDb(`workorder-date:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange forespørsler. Prøv igjen om litt." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { id } = await params;

  const parsed = await readJsonWithLimit(request, JSON_BODY_LIMIT);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? "Forespørselen er for stor" : "Ugyldig data" },
      { status: parsed.status },
    );
  }

  const result = await updateWorkOrderDate(user, id, parsed.data);
  if (result.ok) return NextResponse.json({ success: true });

  switch (result.error) {
    case "ikke-autentisert":
      return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
    case "ingen-tilgang":
      return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
    case "ugyldig-dato":
      return NextResponse.json({ error: "Ugyldig dato" }, { status: 400 });
    case "dato-mangler":
      return NextResponse.json({ error: "Dato mangler" }, { status: 400 });
    case "ugyldig-sluttdato":
      return NextResponse.json({ error: "Ugyldig sluttdato" }, { status: 400 });
    case "sluttdato-for-startdato":
      return NextResponse.json(
        { error: "Sluttdato kan ikke være før startdato" },
        { status: 400 },
      );
    case "ikke-funnet":
      return NextResponse.json({ error: "Oppdraget finnes ikke" }, { status: 404 });
    case "legal-hold":
      return NextResponse.json(
        { error: "Oppdraget har bevaringsplikt og kan ikke flyttes" },
        { status: 403 },
      );
    case "ukjent":
      return NextResponse.json(
        { error: "Kunne ikke oppdatere dato" },
        { status: 500 },
      );
  }
}
