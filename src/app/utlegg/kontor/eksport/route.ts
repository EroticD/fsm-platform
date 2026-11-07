import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { moduleApiGuard } from "@/lib/module-guards";
import { exportPayroll } from "@/server/expenses";

/** Nedlasting av lønnsgrunnlag. Selve filen er låst per avdeling/periode. */
export async function GET(request: Request) {
  const guard = await moduleApiGuard("fieldExpenses");
  if (guard) return guard;

  const user = await getCurrentUser();
  if (!user?.isActive) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const departmentId = url.searchParams.get("avdeling");

  const result = await exportPayroll(user, {
    start,
    end,
    departmentId,
  });
  if (!result.ok) {
    const status =
      result.reason === "forbidden"
        ? 403
        : result.reason === "not_found"
          ? 404
          : result.reason === "conflict"
            ? 409
            : 400;
    return NextResponse.json(
      { error: result.reason, details: result.details ?? null },
      { status },
    );
  }

  return new Response(result.data.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lonn-${result.data.period.start}-${result.data.period.end}.csv"`,
      "Cache-Control": "no-store",
      "X-Payroll-Checksum": result.data.checksum,
      "X-Payroll-Idempotent": result.data.existing ? "true" : "false",
    },
  });
}
