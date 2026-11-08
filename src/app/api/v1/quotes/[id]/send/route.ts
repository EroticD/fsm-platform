import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { sendQuote } from "@/server/quotes";
import { canManageQuotes, quoteError } from "../../_shared";

export const runtime = "nodejs";

/**
 * Sender et tilbud til kunden. Tjenestelaget fryser linjene i en versjon,
 * utsteder en engangslenke og legger e-posten i utboksen. Selve tokenet
 * returneres ikke til integrasjonen; det går bare via kundens e-post.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  if (!canManageQuotes(auth.actor)) {
    return apiError("forbidden", 403, {
      messageKey: "errors.api.quotes.sendForbidden",
    });
  }

  const { id } = await params;
  const result = await sendQuote(auth.actor, id);
  if (!result.ok) {
    return quoteError(result.reason, {
      forbidden: "errors.api.quotes.sendForbidden",
      notFound: "errors.api.quotes.notFound",
      conflict: "errors.api.quotes.conflict",
      validation: "errors.api.quotes.validation",
    });
  }

  return apiJson({
    id,
    status: "SENT",
    version: result.data.version,
  });
}
