import {
  guardTransferRoute,
  requireSameOrigin,
  transferFailureResponse,
  transferJson,
} from "@/lib/customer-transfer/http";
import { abortTransferJob } from "@/server/customer-transfer";

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
  const { jobId } = await params;
  const result = await abortTransferJob(guard.actor, jobId);
  if (!result.ok) return transferFailureResponse(result);
  return transferJson(result.data);
}
