import {
  guardTransferRoute,
  transferFailureResponse,
  transferJson,
  transferRateLimit,
} from "@/lib/customer-transfer/http";
import { getImportPreview } from "@/server/customer-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await guardTransferRoute();
  if (!guard.ok) return guard.response;
  const limited = await transferRateLimit(
    `customer-transfer-status:${guard.actor.id}`,
    120,
    60_000,
  );
  if (limited) return limited;
  const { jobId } = await params;
  const result = await getImportPreview(guard.actor, jobId);
  if (!result.ok) return transferFailureResponse(result);
  return transferJson(result.data);
}
