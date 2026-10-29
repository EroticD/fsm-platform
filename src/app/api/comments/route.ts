import { NextResponse } from "next/server";
import { WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { markdownToPlainText } from "@/lib/markdown";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { workOrderScope } from "@/lib/access";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { assertSameOrigin } from "@/lib/origin";
import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";

/** Kommentarer kan festes til disse tre tingene – og ikke noe annet. */
const ENTITY_TYPES = ["workOrder", "customer", "contact"] as const;

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "Ugyldig origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
  }

  if (!user.isActive) {
    return NextResponse.json({ error: "Bruker ikke funnet" }, { status: 404 });
  }

  // Maks 30 kommentarer per minutt per konto (hindrer spam).
  const limit = await allowRequestDb(`comments:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "For mange kommentarer. Prøv igjen om litt." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const parsed = await readJsonWithLimit<Record<string, unknown>>(
    request,
    JSON_BODY_LIMIT,
  );
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? "Kommentaren er for stor" : "Ugyldig data" },
      { status: parsed.status },
    );
  }

  const body = parsed.data;
  const entityType = String(body.entityType ?? "");
  const entityId = cleanText(body.entityId, { maxLength: LIMITS.line });
  const content = cleanMarkdown(body.content);
  // Forfatteren hentes fra økten, ikke fra klienten, slik at aktivitetsloggen
  // ikke kan forfalskes ved å sende et annet navn.
  const authorName = user.name || user.email || "Ukjent";

  if (!ENTITY_TYPES.includes(entityType as (typeof ENTITY_TYPES)[number])) {
    return NextResponse.json({ error: "Ukjent type" }, { status: 400 });
  }
  if (!entityId || !content) {
    return NextResponse.json({ error: "Manglende felt" }, { status: 400 });
  }

  // Kontroller at brukeren faktisk har tilgang til det kommentaren festes til.
  if (entityType === "workOrder") {
    if (!hasPermission(user, "workorders.update")) {
      return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
    }
    const target = await prisma.workOrder.findFirst({
      where: {
        id: entityId,
        ...workOrderScope(user),
        ...(user.role === "TECHNICIAN"
          ? { status: { not: WorkStatus.CANCELLED } }
          : {}),
      },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Oppdraget finnes ikke" }, { status: 404 });
    }
  } else if (entityType === "customer") {
    if (!hasPermission(user, "customers.manage")) {
      return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
    }
    const target = await prisma.customer.findFirst({
      where: { id: entityId, deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Kunden finnes ikke" }, { status: 404 });
    }
  } else {
    if (!hasPermission(user, "customers.manage")) {
      return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
    }
    const target = await prisma.contact.findUnique({
      where: { id: entityId },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Kontakten finnes ikke" }, { status: 404 });
    }
  }

  try {
    const data: {
      content: string;
      authorName: string;
      workOrderId?: string;
      customerId?: string;
      contactId?: string;
    } = { content, authorName };
    if (entityType === "workOrder") data.workOrderId = entityId;
    if (entityType === "customer") data.customerId = entityId;
    if (entityType === "contact") data.contactId = entityId;

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({ data });

      // Kommentaren og revisjonsraden skrives i samme transaksjon, med
      // forfatterens faktiske id. Da finnes det ingen kommentar uten logg.
      await audit(tx, {
        entityType: entityType.charAt(0).toUpperCase() + entityType.slice(1),
        entityId,
        action: `La til kommentar: "${markdownToPlainText(content).slice(0, 50)}..."`,
        actor: { id: user.id, name: user.name, email: user.email },
        metadata: { commentId: created.id },
      });

      return created;
    });

    return NextResponse.json({ success: true, comment });
  } catch (error) {
    console.error("Feil ved opprettelse av kommentar:", error);
    return NextResponse.json({ error: "Kunne ikke lagre kommentar" }, { status: 500 });
  }
}
