import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";

export default async function ReportViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/logg-inn");

  const viewer = await prisma.user.findUnique({ where: { email: session.user.email } });

  const resolvedParams = await params;

  const workOrder = await prisma.workOrder.findUnique({
    where: { id: resolvedParams.id },
    include: {
      customer: true,
      reports: { select: { id: true } },
    },
  });

  if (!workOrder) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 p-8 text-center">
        <p className="text-gray-600 font-medium">Fant ikke oppdraget.</p>
        <Link href="/" className="bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold">
          Tilbake
        </Link>
      </div>
    );
  }

  // Kundeportalbrukere kan kun se rapporter som tilhører deres egen kundekonto.
  // Sjekkes før alt annet, slik at man ikke engang kan se at oppdraget finnes.
  if (viewer?.role === "CUSTOMER" && workOrder.customerId !== viewer.customerId) {
    redirect("/kundeportal");
  }

  if (workOrder.reports.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 p-8 text-center">
        <p className="text-gray-600 font-medium">Fant ingen rapport på dette oppdraget ennå.</p>
        <Link href="/" className="bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold">
          Tilbake
        </Link>
      </div>
    );
  }

  const backHref =
    viewer?.role === "CUSTOMER" ? "/kundeportal" : `/kunder/${workOrder.customer?.id}`;
  const backLabel = viewer?.role === "CUSTOMER" ? "Tilbake til portalen" : "Lukk PDF";

  // PDF-en genereres på serveren og vises i en <iframe>. Da virker den i alle
  // nettlesere (også på mobil), og den kan lastes ned eller deles som en vanlig
  // lenke: /api/rapporter/<oppdragsId>/pdf
  const pdfUrl = `/api/rapporter/${resolvedParams.id}/pdf`;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-gray-100">
      <div className="bg-gray-900 text-white p-4 flex flex-wrap justify-between items-center gap-3 shadow-md">
        <div>
          <h1 className="font-bold">Rapport for: {workOrder.title}</h1>
          <p className="text-xs text-gray-400">{workOrder.customer?.name || "Uten kunde"}</p>
        </div>
        <div className="flex items-center gap-2">
          {viewer?.role !== "CUSTOMER" && (
            <a
              href={`${pdfUrl}?download=1`}
              download
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm font-bold transition"
            >
              ⬇ Last ned PDF
            </a>
          )}
          <Link
            href={backHref}
            className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm font-medium transition"
          >
            {backLabel}
          </Link>
        </div>
      </div>

      <iframe
        src={pdfUrl}
        title={`Servicerapport – ${workOrder.title}`}
        className="flex-1 w-full border-0 bg-gray-200"
      />
    </div>
  );
}
