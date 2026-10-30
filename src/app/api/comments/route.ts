import { NextResponse } from "next/server";
import { internalApiError } from "@/lib/api-errors";
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
    return internalApiError("invalid_origin", 403);
  }

  const user = await getCurrentUser();
  if (!user) {
    return internalApiError("not_authenticated", 401);
  }

  if (!user.isActive) {
    return internalApiError("user_not_found", 404);
  }

  // Maks 30 kommentarer per minutt per konto (hindrer spam).
  const limit = await allowRequestDb(`comments:${user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return internalApiError("rate_limited", 429, {
      messageKey: "errors.api.comments.rateLimited",
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const parsed = await readJsonWithLimit<Record<string, unknown>>(
    request,
    JSON_BODY_LIMIT,
  );
  if (!parsed.ok) {
    return parsed.status === 413
      ? internalApiError("too_large", 413, {
          messageKey: "errors.api.comments.tooLarge",
        })
      : internalApiError("invalid_data", 400, {
          messageKey: "errors.api.comments.invalidData",
        });
  }

  const body = parsed.data;
  const entityType = String(body.entityType ?? "");
  const entityId = cleanText(body.entityId, { maxLength: LIMITS.line });
  const content = cleanMarkdown(body.content);
  // Forfatteren hentes fra økten, ikke fra klienten, slik at aktivitetsloggen
  // ikke kan forfalskes ved å sende et annet navn.
  const authorName = user.name || user.email || "Ukjent";

  if (!ENTITY_TYPES.includes(entityType as (typeof ENTITY_TYPES)[number])) {
    return internalApiError("unknown_entity", 400, {
      messageKey: "errors.api.comments.unknownType",
    });
  }
  if (!entityId || !content) {
    return internalApiError("missing_field", 400, {
      messageKey: "errors.api.comments.missingField",
    });
  }

  // Kontroller at brukeren faktisk har tilgang til det kommentaren festes til.
  if (entityType === "workOrder") {
    if (!hasPermission(user, "workorders.update")) {
      return internalApiError("forbidden", 403);
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
      return internalApiError("not_found", 404, {
        messageKey: "errors.api.comments.workOrderNotFound",
      });
    }
  } else if (entityType === "customer") {
    if (!hasPermission(user, "customers.manage")) {
      return internalApiError("forbidden", 403);
    }
    const target = await prisma.customer.findFirst({
      where: { id: entityId, deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      return internalApiError("not_found", 404, {
        messageKey: "errors.api.comments.customerNotFound",
      });
    }
  } else {
    if (!hasPermission(user, "customers.manage")) {
      return internalApiError("forbidden", 403);
    }
    const target = await prisma.contact.findUnique({
      where: { id: entityId },
      select: { id: true },
    });
    if (!target) {
      return internalApiError("not_found", 404, {
        messageKey: "errors.api.comments.contactNotFound",
      });
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
    return internalApiError("server_error", 500, {
      messageKey: "errors.api.comments.saveFailed",
    });
  }
}
