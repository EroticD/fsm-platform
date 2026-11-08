import {
  guardTransferRoute,
  requireSameOrigin,
  transferFailureResponse,
  transferJson,
} from "@/lib/customer-transfer/http";
import { confirmImport } from "@/server/customer-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await guardTransferRoute();
  if (!guard.ok) return guard.response;
  const origin = requireSameOrigin(request);
  if (origin) return origin;

  let body: {
    previewToken?: unknown;
    policies?: unknown;
    createMissingReferences?: unknown;
    confirmation?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return transferJson(
      { error: "invalid_json", messageKey: "errors.api.invalidJson" },
      { status: 400 },
    );
  }
  if (typeof body.previewToken !== "string" || !body.previewToken) {
    return transferJson(
      {
        error: "customer_transfer.preview_expired",
        messageKey: "errors.customerTransfer.previewExpired",
      },
      { status: 409 },
    );
  }

  const { jobId } = await params;
  const result = await confirmImport(
    guard.actor,
    jobId,
    {
      previewToken: body.previewToken,
      policies: body.policies,
      createMissingReferences: body.createMissingReferences === true,
      confirmation: body.confirmation === true,
    },
    { mode: "queue" },
  );
  if (!result.ok) return transferFailureResponse(result);
  return transferJson(result.data, { status: 202 });
}
