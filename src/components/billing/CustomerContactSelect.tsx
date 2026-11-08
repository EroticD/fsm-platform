"use client";

import { useRef, useState } from "react";

export type CustomerContactOption = {
  id: string;
  name: string;
  customerNumber?: string | null;
};

export type ContactOption = {
  id: string;
  name: string;
  role?: string | null;
  customerId: string;
};

type Labels = {
  customer: string;
  chooseCustomer: string;
  contact: string;
  noContact: string;
  loadingContacts: string;
  noContacts: string;
};

const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]";
const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm";

/**
 * Kunde- og kontaktvelger med hard kundescoping.
 *
 * Kontaktfeltet rendres først når en kunde er valgt. Kontaktene hentes fra
 * `/api/kunder/kontakter?customerId=...` og filtreres på nytt i klienten, slik
 * at en kontakt fra en annen kunde aldri kan vises eller sendes inn.
 */
export default function CustomerContactSelect({
  customers,
  defaultCustomerId = "",
  defaultContactId = "",
  initialContacts = [],
  labels,
}: {
  customers: CustomerContactOption[];
  defaultCustomerId?: string;
  defaultContactId?: string;
  initialContacts?: ContactOption[];
  labels: Labels;
}) {
  const [customerId, setCustomerId] = useState(defaultCustomerId);
  const [contacts, setContacts] = useState<ContactOption[]>(() =>
    initialContacts.filter(
      (contact) => contact.customerId === defaultCustomerId,
    ),
  );
  const [contactId, setContactId] = useState(() =>
    initialContacts.some(
      (contact) =>
        contact.customerId === defaultCustomerId &&
        contact.id === defaultContactId,
    )
      ? defaultContactId
      : "",
  );
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  function changeCustomer(nextCustomerId: string) {
    setCustomerId(nextCustomerId);
    setContactId("");
    setContacts([]);
    if (!nextCustomerId) {
      setLoading(false);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    fetch(`/api/kunder/kontakter?customerId=${encodeURIComponent(nextCustomerId)}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("contacts");
        const payload = (await response.json()) as {
          contacts?: ContactOption[];
        };
        return Array.isArray(payload.contacts) ? payload.contacts : [];
      })
      .then((next) => {
        if (requestRef.current !== requestId) return;
        const own = next.filter(
          (contact) => contact.customerId === nextCustomerId,
        );
        setContacts(own);
        setContactId("");
      })
      .catch(() => {
        if (requestRef.current !== requestId) return;
        // Feil skal aldri falle tilbake til en ufiltrert kontaktliste.
        setContacts([]);
        setContactId("");
      })
      .finally(() => {
        if (requestRef.current === requestId) setLoading(false);
      });
  }

  return (
    <>
      <label>
        <span className={LABEL}>{labels.customer}</span>
        <select
          name="customerId"
          value={customerId}
          onChange={(event) => changeCustomer(event.target.value)}
          required
          className={INPUT}
        >
          <option value="">{labels.chooseCustomer}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
              {customer.customerNumber ? ` · ${customer.customerNumber}` : ""}
            </option>
          ))}
        </select>
      </label>

      {customerId ? (
        <label>
          <span className={LABEL}>{labels.contact}</span>
          {loading ? (
            <select disabled className={INPUT} aria-busy="true">
              <option>{labels.loadingContacts}</option>
            </select>
          ) : contacts.length === 0 ? (
            <>
              <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
                {labels.noContacts}
              </p>
              <input type="hidden" name="contactId" value="" />
            </>
          ) : (
            <select
              name="contactId"
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className={INPUT}
            >
              <option value="">{labels.noContact}</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.role ? ` · ${contact.role}` : ""}
                </option>
              ))}
            </select>
          )}
        </label>
      ) : null}
    </>
  );
}
