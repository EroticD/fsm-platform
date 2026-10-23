import Link from "next/link";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import { contractIntervalLabel } from "@/lib/contracts";
import { CONTRACT_INTERVAL_MONTHS } from "@/lib/contracts";
import { formatDate, toDateOnly } from "@/lib/dates";
import type { CustomerDetailData } from "@/server/customers";
import CustomerTabPanel from "./CustomerTabPanel";

type ContractsTabProps = {
  customer: CustomerDetailData["customer"];
  templates: CustomerDetailData["templates"];
  departments: CustomerDetailData["departments"];
  defaultDepartmentId: string | null;
  office: boolean;
  isAdmin: boolean;
  ownDepartmentId: string | null;
  userDepartmentName: string | null;
  createContract: (formData: FormData) => Promise<void>;
  toggleContract: (formData: FormData) => Promise<void>;
  deleteContract: (formData: FormData) => Promise<void>;
};

export default function CustomerContractsTab({
  customer,
  templates,
  departments,
  defaultDepartmentId,
  office,
  isAdmin,
  ownDepartmentId,
  userDepartmentName,
  createContract,
  toggleContract,
  deleteContract,
}: ContractsTabProps) {
  return (
    <CustomerTabPanel
      title="📄 Serviceavtaler"
      description="Gjentagende service med fast intervall. Ved hvert intervall opprettes et nytt oppdrag med kundedata og en ny, tom sjekkliste. Forrige rapport legges ved som PDF."
    >
      {office && (isAdmin || ownDepartmentId) && (
        <form
          action={createContract}
          className="space-y-3 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Tittel *
              </label>
              <input
                type="text"
                name="title"
                required
                placeholder="F.eks. Årlig service på portanlegg"
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Avdeling *
              </label>
              {isAdmin ? (
                <select
                  name="departmentId"
                  required
                  defaultValue={defaultDepartmentId ?? ""}
                  className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                      {department.isDefault ? " (standard)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="w-full border border-gray-200 bg-white p-2 rounded-xl text-sm text-gray-800 font-bold">
                  {userDepartmentName || "Ingen avdeling"}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Startdato *
              </label>
              <input
                type="date"
                name="startDate"
                required
                defaultValue={toDateOnly(new Date())}
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Intervall *
              </label>
              <select
                name="intervalMonths"
                required
                defaultValue="12"
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              >
                {CONTRACT_INTERVAL_MONTHS.map((months) => (
                  <option key={months} value={months}>
                    {contractIntervalLabel(months)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Kontaktperson (valgfritt)
              </label>
              <select
                name="contactId"
                defaultValue=""
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              >
                <option value="">Bruk kundens første kontaktperson</option>
                {customer.contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                    {contact.role ? ` (${contact.role})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Sjekkliste (valgfritt)
              </label>
              <select
                name="templateId"
                defaultValue=""
                className="w-full border border-gray-300 p-2 rounded-xl text-sm text-gray-900 bg-white"
              >
                <option value="">Ingen sjekkliste</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            Sjekklisten festes til hvert nye oppdrag, men rapporten er alltid
            ny og tom. Er startdatoen i dag, opprettes første oppdrag med en
            gang. Er den i fortiden, brukes neste framtidige intervall.
          </p>
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow-sm"
          >
            Opprett serviceavtale
          </button>
        </form>
      )}

      {office && !isAdmin && !ownDepartmentId && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 font-bold">
          Du må være knyttet til en avdeling for å opprette serviceavtaler.
        </p>
      )}

      {customer._count.contracts === 0 ? (
        <p className="text-xs text-gray-500 italic">
          Ingen serviceavtaler registrert på denne kunden.
        </p>
      ) : (
        <div className="space-y-3">
          {customer.contracts.map((contract) => {
            const latestOrder = contract.workOrders[0];
            return (
              <div
                key={contract.id}
                className="bg-gray-50 rounded-xl border border-gray-200 p-3 sm:p-4 space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div>
                    <p className="font-black text-gray-900 text-sm">
                      {contract.title}
                    </p>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      Startdato: {formatDate(contract.startDate, "–")} • Intervall:{" "}
                      {contractIntervalLabel(contract.intervalMonths)} • Neste
                      service: {formatDate(contract.nextServiceDate, "–")}
                    </p>
                    <p className="text-[11px] text-gray-600">
                      Sjekkliste:{" "}
                      <span className="font-bold text-blue-800">
                        {contract.template?.title || "Ingen"}
                      </span>
                    </p>
                    <p className="text-[11px] text-gray-600">
                      🏷️ Avdeling:{" "}
                      <span className="font-bold">{contract.department.name}</span>
                    </p>
                  </div>
                  <span
                    className={`self-start text-[10px] font-bold px-2 py-1 rounded-full border uppercase ${
                      contract.isActive
                        ? "bg-green-100 text-green-800 border-green-200"
                        : "bg-amber-100 text-amber-800 border-amber-200"
                    }`}
                  >
                    {contract.isActive ? "Aktiv" : "Pauset"}
                  </span>
                </div>

                {latestOrder && (
                  <Link
                    href={`/oppdrag/${latestOrder.id}`}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline"
                  >
                    Siste oppdrag: {latestOrder.title} •{" "}
                    {formatDate(latestOrder.scheduledFor, "Ingen dato")} →
                  </Link>
                )}

                {office && (isAdmin || contract.departmentId === ownDepartmentId) && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200">
                    <form action={toggleContract}>
                      <input type="hidden" name="id" value={contract.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={contract.isActive ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition ${
                          contract.isActive
                            ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                            : "bg-green-600 text-white border-green-600 hover:bg-green-700"
                        }`}
                      >
                        {contract.isActive ? "Pause" : "Aktiver"}
                      </button>
                    </form>
                    {isAdmin && (
                      <ConfirmSubmitForm
                        action={deleteContract}
                        confirmMessage={`Slette serviceavtalen «${contract.title}»? Oppdrag som allerede er opprettet blir liggende.`}
                      >
                        <input type="hidden" name="id" value={contract.id} />
                        <button
                          type="submit"
                          className="text-[10px] font-bold px-3 py-1.5 rounded-lg border bg-red-50 text-red-700 border-red-200 hover:bg-red-100 transition"
                        >
                          Slett
                        </button>
                      </ConfirmSubmitForm>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CustomerTabPanel>
  );
}
