import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { getCurrentUser, isOffice, requireOffice } from "@/lib/session";

export default async function KunderPage() {
  // Sjekk at brukeren er logget inn
  const session = await getServerSession();
  if (!session) redirect("/api/auth/signin");

  // Montører får lese kundekatalogen, men ikke registrere nye kunder.
  const user = await getCurrentUser();
  const office = isOffice(user?.role);

  // Hent alle kunder fra databasen, sortert alfabetisk
  const customers = await prisma.customer.findMany({
    orderBy: { name: 'asc' }
  });

  // Dette er en "Server Action" som kjører trygt på serveren når skjemaet sendes inn
  async function addCustomer(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    
    const name = formData.get("name") as string;
    const orgNumber = formData.get("orgNumber") as string;

    if (name) {
      // Lagrer i databasen
      await prisma.customer.create({
        data: { name, orgNumber },
      });
      // Oppdaterer siden umiddelbart slik at den nye kunden vises
      revalidatePath("/kunder"); 
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        
        {/* Navigasjon på toppen */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Kundekatalog</h1>
          <Link href="/" className="text-blue-600 hover:underline font-medium">
            &larr; Tilbake til Dashbord
          </Link>
        </div>

        {/* Skjema for å legge til ny kunde – kun kontor/admin */}
        {office && (
          <div className="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Registrer ny kunde</h2>
            <form action={addCustomer} className="flex gap-4">
              <input
                type="text"
                name="name"
                placeholder="Firmanavn"
                required
                className="border p-2 rounded flex-1 text-gray-800"
              />
              <input
                type="text"
                name="orgNumber"
                placeholder="Org.nummer (valgfritt)"
                className="border p-2 rounded flex-1 text-gray-800"
              />
              <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition font-medium">
                Lagre kunde
              </button>
            </form>
          </div>
        )}

        {/* Tabell med eksisterende kunder */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-4 font-semibold text-gray-600 border-b">Firmanavn</th>
                <th className="p-4 font-semibold text-gray-600 border-b">Org.nummer</th>
                <th className="p-4 font-semibold text-gray-600 border-b w-32">Handling</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-gray-500">
                    Ingen kunder registrert enda. Legg til din første kunde over!
                  </td>
                </tr>
              ) : (
                customers.map(customer => (
                  <tr key={customer.id} className="hover:bg-gray-50 transition border-b last:border-0">
                    <td className="p-4 font-medium text-gray-800">{customer.name}</td>
                    <td className="p-4 text-gray-600">{customer.orgNumber || "-"}</td>
                    <td className="p-4">
                      <Link href={`/kunder/${customer.id}`} className="text-blue-600 hover:underline text-sm font-medium block">Se detaljer</Link>
                      <Link href={`/kunder/${customer.id}/rediger`} className="text-gray-600 hover:underline text-sm font-medium">Rediger</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
