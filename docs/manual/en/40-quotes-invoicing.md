# Quotes and invoicing

Quotes and invoicing are separate modules. An administrator must enable them
before `/tilbud` and `/faktura` are available.

## Quotes

1. Choose **Quotes → New quote**.
2. Select customer, optionally contact, work order, contract and equipment.
3. Add lines with quantity, price and VAT. The system calculates the totals.
4. Save the draft. Drafts can be edited and versioned.
5. Send the quote. A short-lived approval link is shown; share it with the
   customer.
6. The customer accepts or rejects in the browser without signing in.
7. An accepted quote can be converted to a work order. The customer is reused,
   and equipment is linked to the work order.

A link can only be used once. Expired quotes must be sent again.

## Invoices

1. Choose **Invoices → New invoice**.
2. Select customer and optionally a completed work order, report or accepted
   quote.
3. Add lines. The invoice is saved as a draft.
4. Send the invoice. A unique invoice number is assigned, and the lines are
   frozen.
5. Register payments manually with amount, date, method and reference. Partial
   payments are supported.
6. If needed, register a credit note. A credit note cannot exceed the
   outstanding amount.
7. Overdue invoices can be updated manually or by a scheduled job.

This version has no card payment or external payment provider. The customer
pays by bank transfer and uses the invoice number as the reference. Accounting
can download a CSV from the invoice list.

## Customer portal

Customers can see their own sent invoices and payment status at
`/kundeportal/faktura` when both the portal and invoicing modules are enabled.
Customers cannot pay by card in the portal.
