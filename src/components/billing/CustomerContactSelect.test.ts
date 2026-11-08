import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CustomerContactSelect from "./CustomerContactSelect";

const labels = {
  customer: "Kunde",
  chooseCustomer: "Velg kunde",
  contact: "Kontaktperson",
  noContact: "Ingen kontaktperson",
  loadingContacts: "Henter …",
  noContacts: "Ingen kontakter",
};

const customers = [
  { id: "c1", name: "Kunde En", customerNumber: "1001" },
  { id: "c2", name: "Kunde To", customerNumber: "1002" },
];

const contacts = [
  { id: "p1", name: "Kontakt En", role: "Drift", customerId: "c1" },
  { id: "p2", name: "Kontakt To", role: "Økonomi", customerId: "c2" },
];

function render(props: Record<string, unknown>) {
  return renderToStaticMarkup(
    createElement(CustomerContactSelect, { customers, labels, ...props }),
  );
}

describe("CustomerContactSelect", () => {
  it("viser ikke kontaktvalg før kunde er valgt", () => {
    const html = render({});
    expect(html).toContain('name="customerId"');
    expect(html).not.toContain('name="contactId"');
    expect(html).not.toContain("Kontakt En");
  });

  it("viser bare kontakter som tilhører valgt kunde", () => {
    const html = render({
      defaultCustomerId: "c1",
      initialContacts: contacts,
    });
    expect(html).toContain("Kontakt En");
    expect(html).not.toContain("Kontakt To");
  });

  it("fjerner et standardvalg som ikke tilhører kunden", () => {
    const html = render({
      defaultCustomerId: "c1",
      defaultContactId: "p2",
      initialContacts: contacts,
    });
    expect(html).toContain("Kontakt En");
    expect(html).not.toContain("Kontakt To");
    expect(html).not.toContain('value="p2" selected');
  });
});
