import { NextResponse } from "next/server";
import { attachmentDisposition } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { getContractPdf } from "@/server/contracts";

export const runtime = "nodejs";

const LOCALES = new Set(["nb", "en", "pl", "de"]);

/** PDF for den innloggede nettleserøkten (API-et har egen Bearer-rute). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentDisposition(result.fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
