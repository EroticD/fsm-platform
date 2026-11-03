import {
  guardTransferRoute,
  requireSameOrigin,
  transferFailureResponse,
  transferJson,
  transferRateLimit,
} from "@/lib/customer-transfer/http";
import { dryRunImport } from "@/server/customer-transfer";

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

  const limited = await transferRateLimit(
    `customer-transfer-dryrun:${guard.actor.id}`,
    10,
    60 * 60 * 1000,
  );
  if (limited) return limited;

  const { jobId } = await params;
  let body: { createMissingReferences?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const result = await dryRunImport(guard.actor, jobId, {
    createMissingReferences: body.createMissingReferences === true,
  });
  if (!result.ok) return transferFailureResponse(result);
  return transferJson(result.data);
}
