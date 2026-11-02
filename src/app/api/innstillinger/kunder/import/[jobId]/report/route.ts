import {
  guardTransferRoute,
  transferFailureResponse,
  transferJson,
} from "@/lib/customer-transfer/http";
import { getImportReport } from "@/server/customer-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const guard = await guardTransferRoute();
  if (!guard.ok) return guard.response;
  const { jobId } = await params;
  const result = await getImportReport(guard.actor, jobId);
  if (!result.ok) return transferFailureResponse(result);
  return transferJson(result.data);
}
