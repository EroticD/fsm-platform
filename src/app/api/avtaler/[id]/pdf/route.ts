import { NextResponse } from "next/server";
import { auditRequestContext, auditStandalone } from "@/lib/audit";
import { attachmentDisposition } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { getContractPdf } from "@/server/contracts";
import { moduleApiGuard } from "@/lib/module-guards";

export const runtime = "nodejs";

const LOCALES = new Set(["nb", "en", "pl", "de"]);

/** Best effort: revisjonsloggen skal aldri velte en nedlasting. */
async function logContractPdfView(input: {
  user: {
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
      action: "Viste avtale-PDF",
      actor: {
        id: input.user.id,
        name: input.user.name ?? null,
        email: input.user.email ?? null,
        departmentId: input.user.departmentId ?? null,
      },
      actionCode: "contract.pdf.viewed",
      // Avtaler er regnskapsmateriale og skal oppbevares i fem år.
      retentionClass: "ACCOUNTING_5Y",
      metadata: { locale: input.locale, channel: "web" },
      context: await auditRequestContext(),
    });
  } catch (error) {
    console.error("[audit] kunne ikke logge contract.pdf.viewed", {
      contractId: input.contractId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** PDF for den innloggede nettleserøkten (API-et har egen Bearer-rute). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const moduleGuard = await moduleApiGuard("contracts");
  if (moduleGuard) return moduleGuard;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized" } },
      { status: 401 },
    );
  }

  const { id } = await params;
  const url = new URL(request.url);
  const localeRaw = (url.searchParams.get("locale") ?? "nb").toLowerCase();
  const locale = LOCALES.has(localeRaw) ? localeRaw : "nb";
  const result = await getContractPdf(user, id, locale);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.status === 403 ? "forbidden" : "not_found" } },
      { status: result.status },
    );
  }

  await logContractPdfView({
    user,
    contractId: id,
    locale,
  });

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentDisposition(result.fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
