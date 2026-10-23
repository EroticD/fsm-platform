/** Statusetikett for kundekortets oppdragsliste. */
export default function CustomerStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "COMPLETED":
      return <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold border border-green-200 shadow-sm">✅ Fullført</span>;
    case "IN_PROGRESS":
      return <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold border border-blue-200 shadow-sm">🔄 Påbegynt</span>;
    case "CANCELLED":
      return <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold border border-red-200 shadow-sm">❌ Kansellert</span>;
    case "OPEN":
      return <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-bold border border-purple-200 shadow-sm">✨ Åpen</span>;
    default:
      return <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold border border-yellow-200 shadow-sm">⏳ Planlagt</span>;
  }
}
