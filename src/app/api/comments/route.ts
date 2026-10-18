import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { markdownToPlainText } from "@/lib/markdown";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";

/** Kommentarer kan festes til disse tre tingene – og ikke noe annet. */
const ENTITY_TYPES = ["workOrder", "customer", "contact"] as const;

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) {
    return NextResponse.json({ error: "Bruker ikke funnet" }, { status: 404 });
  }

  const body = await request.json();
  const entityType = String(body.entityType ?? "");
  const entityId = cleanText(body.entityId, { maxLength: LIMITS.line });
  const content = cleanMarkdown(body.content);
  const authorName = cleanText(body.authorName, { maxLength: LIMITS.title }) || user.name || "Ukjent";

  if (!ENTITY_TYPES.includes(entityType as (typeof ENTITY_TYPES)[number])) {
    return NextResponse.json({ error: "Ukjent type" }, { status: 400 });
  }
  if (!entityId || !content) {
    return NextResponse.json({ error: "Manglende felt" }, { status: 400 });
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

    const comment = await prisma.comment.create({
      data,
    });

    await prisma.auditLog.create({
      data: {
        entityType: entityType.charAt(0).toUpperCase() + entityType.slice(1),
        entityId,
        action: `La til kommentar: "${markdownToPlainText(content).slice(0, 50)}..."`,
        userName: user.name || "Ukjent",
      },
    });

    return NextResponse.json({ success: true, comment });
  } catch (error) {
    console.error("Feil ved opprettelse av kommentar:", error);
    return NextResponse.json({ error: "Kunne ikke lagre kommentar" }, { status: 500 });
  }
}
