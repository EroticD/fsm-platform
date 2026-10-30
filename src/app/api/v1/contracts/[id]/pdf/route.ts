import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError } from "@/lib/api-response";
import { attachmentDisposition } from "@/lib/http";
import { hasPermission } from "@/lib/permissions";
import { getContractPdf } from "@/server/contracts";

export const runtime = "nodejs";

const LOCALES = new Set(["nb", "en", "pl", "de"]);

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
    return apiError(403, "forbidden", "Du har ikke tilgang til avtaler.");
  }

  const { id } = await params;
  const url = new URL(request.url);
  const localeRaw = (url.searchParams.get("locale") ?? "nb").toLowerCase();
  const locale = LOCALES.has(localeRaw) ? localeRaw : "nb";
  const result = await getContractPdf(auth.actor, id, locale);
  if (!result.ok) {
    return apiError(
      result.status,
      result.status === 403 ? "forbidden" : "not_found",
      result.message,
    );
  }

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
