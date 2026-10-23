import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { assertSameOrigin } from "@/lib/origin";
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

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
  }

  const result = await updateWorkOrderDate(user, id, body);
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
    case "ukjent":
      return NextResponse.json(
        { error: "Kunne ikke oppdatere dato" },
        { status: 500 },
      );
  }
}
