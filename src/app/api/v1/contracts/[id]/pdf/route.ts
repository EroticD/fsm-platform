import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";
import { auditRequestContext, auditStandalone } from "@/lib/audit";
import { attachmentDisposition } from "@/lib/http";
import { hasPermission } from "@/lib/permissions";
import { getContractPdf } from "@/server/contracts";

export const runtime = "nodejs";

const LOCALES = new Set(["nb", "en", "pl", "de"]);

/** Best effort: revisjonsloggen skal aldri velte et API-svar. */
async function logContractPdfView(input: {
  actor: {
    id: string;
    name?: string | null;
    email?: string | null;
    departmentId?: string | null;
  };
  contractId: string;
  locale: string;
}): Promise<void> {
  try {
    await auditStandalone({
      entityType: "Contract",
      entityId: input.contractId,
      action: "Viste avtale-PDF via API",
      actor: {
        id: input.actor.id,
        name: input.actor.name ?? null,
        email: input.actor.email ?? null,
        departmentId: input.actor.departmentId ?? null,
      },
      actionCode: "contract.pdf.viewed",
      // Avtaler er regnskapsmateriale og skal oppbevares i fem år.
      retentionClass: "ACCOUNTING_5Y",
      metadata: { locale: input.locale, channel: "api" },
      context: await auditRequestContext(),
    });
  } catch (error) {
    console.error("[audit] kunne ikke logge contract.pdf.viewed (API)", {
      contractId: input.contractId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (
    !hasPermission(auth.actor, "contracts.view") &&
    !hasPermission(auth.actor, "contracts.manage")
  ) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.forbidden",
    });
  }

  const { id } = await params;
  const url = new URL(request.url);
  const localeRaw = (url.searchParams.get("locale") ?? "nb").toLowerCase();
  const locale = LOCALES.has(localeRaw) ? localeRaw : "nb";
  const result = await getContractPdf(auth.actor, id, locale);
  if (!result.ok) {
    return apiError(
      result.status === 403 ? "forbidden" : "not_found",
      result.status,
      {
        messageKey:
          result.status === 403
            ? "errors.api.forbidden"
            : "errors.api.notFound",
      },
    );
  }

  await logContractPdfView({
    actor: auth.actor,
    contractId: id,
    locale,
  });

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentDisposition(result.fileName),
      "Cache-Control": "no-store",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
