import { NextResponse } from "next/server";
import { formatDate } from "@/lib/dates";
import { toCsv } from "@/lib/csv";
import { getCurrentUser } from "@/lib/session";
import { listMaterials } from "@/server/materials";
import { listTimeEntries } from "@/server/time";

export const dynamic = "force-dynamic";

function norwegianNumber(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Ikke autentisert", { status: 401 });

  const workOrderId =
    new URL(request.url).searchParams.get("workOrderId")?.trim() ?? "";
  if (!workOrderId) return new NextResponse("Mangler workOrderId", { status: 400 });

  const [timeResult, materialResult] = await Promise.all([
    listTimeEntries(user, workOrderId),
    listMaterials(user, workOrderId),
  ]);
  if (!timeResult.ok || !materialResult.ok) {
    return new NextResponse("Ingen tilgang", { status: 403 });
  }

  const timeEntries = timeResult.data as Array<{
    startedAt: Date;
    minutes: number | null;
    description: string | null;
    billable: boolean;
    hourlyRate: unknown;
  }>;
  const materials = materialResult.data as Array<{
    createdAt: Date;
    name: string;
    sku: string | null;
    quantity: unknown;
    unit: string;
    unitPrice: unknown;
  }>;

  const rows: unknown[][] = [];
  let total = 0;

  for (const entry of timeEntries) {
    const hours = (entry.minutes ?? 0) / 60;
    const rate = Number(entry.hourlyRate ?? 0);
    const amount = entry.billable ? hours * rate : 0;
    total += amount;
    rows.push([
      "Timer",
      formatDate(entry.startedAt),
      entry.description ?? "",
      norwegianNumber(hours),
      "t",
      norwegianNumber(rate),
      norwegianNumber(amount),
    ]);
  }

  for (const material of materials) {
    const quantity = Number(material.quantity);
    const price = Number(material.unitPrice ?? 0);
    const amount = quantity * price;
    total += amount;
    rows.push([
      "Materiale",
      formatDate(material.createdAt),
      `${material.name}${material.sku ? ` (${material.sku})` : ""}`,
      norwegianNumber(quantity),
      material.unit,
      norwegianNumber(price),
      norwegianNumber(amount),
    ]);
  }

  rows.push(["Sum", "", "", "", "", "", norwegianNumber(total)]);

  const csv = toCsv(
    ["Type", "Dato", "Beskrivelse", "Antall", "Enhet", "Pris", "Beløp"],
    rows,
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="okonomi-${workOrderId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
