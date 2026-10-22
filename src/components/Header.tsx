import prisma from "@/lib/prisma";
import Link from "next/link";

export default async function Header({ title }: { title: string }) {
  // Henter merkevaren fra databasen
  const branding = await prisma.branding.findFirst();
  const companyName = branding?.companyName || "Min Bedrift";
  const logoUrl = branding?.logoUrl;
  const primaryColor = branding?.primaryColor || "#2563eb";

  return (
    <div className="flex justify-between items-center border-b pb-6 mb-6">
      <div className="flex items-center gap-4">
        {logoUrl ? (
          <img src={logoUrl} alt={companyName} className="h-10 object-contain" />
        ) : (
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm"
            suppressHydrationWarning
            style={{ backgroundColor: primaryColor }}
          >
            {companyName.charAt(0)}
          </div>
        )}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{companyName} • FSM System</p>
        </div>
      </div>
      
      <div className="flex gap-3">
        <Link href="/" className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 transition shadow-sm text-sm">
          &larr; Dashbord
        </Link>
        <Link href="/innstillinger?tab=branding" className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-200 transition shadow-sm text-sm">
          🎨 Merkevare
        </Link>
      </div>
    </div>
  );
}
