# REV-01 og REV-02 – tilbud og fakturering (v1)

Denne grenen leverer to modulgated vertikale snitt:

- **REV-01 `quotes`** – tilbud med linjer, versjoner, portalgodkjenning og
  konvertering til oppdrag.
- **REV-02 `invoicing`** – fakturaer, manuelle betalinger, delbetaling,
  kreditnotaer, forfallsoppdatering og CSV-eksport.

Kjernen er urørt: navigasjon, innstillinger, dashboard og `src/lib/modules.ts`
følger det modulære rammeverket. Sidene registrerer seg selv med
`requireModulePage`, og API-et bruker `moduleApiGuard`. Fragmentene er koblet inn
i `src/i18n/messages.ts`, modulene er `active` i modulkatalogen, og
navigasjons-/innstillingspunktene er på plass.

> **Tillegg i denne grenen:** betaling via Stripe/Vipps og regnskapssynk mot
> Fiken/Tripletex/PowerOffice Go/CSV. Se `docs/PAYMENTS.md` og
> `docs/ACCOUNTING.md`. Migreringen `20261109090000_payments_accounting` er
> additiv og legger til betalingslenke, PSP-metadata og regnskapstabeller.

## Ruter

| Rute | Modul | Formål |
| --- | --- | --- |
| `/tilbud` | quotes | liste, søk og statusfilter |
| `/tilbud/ny` | quotes | opprett kladd |
| `/tilbud/[id]` | quotes | detalj, sending, versjon, kloning, konvertering |
| `/tilbud/[id]/rediger` | quotes | rediger kladd |
| `/tilbud/[id]/skriv` | quotes | utskriftsvennlig tilbud (nettleserens print-til-PDF) |
| `/tilbud/godkjenn/[token]` | quotes | offentlig godkjenning/avslag med engangstoken |
| `/faktura` | invoicing | liste, filtre, forfalt-sweep, CSV-lenke |
| `/faktura/ny` | invoicing | opprett fakturakladd |
| `/faktura/[id]` | invoicing | detalj, sending, betaling, kreditnota |
| `/faktura/[id]/rediger` | invoicing | rediger kladd |
| `/faktura/[id]/skriv` | invoicing | utskriftsvennlig faktura |
| `/faktura/innstillinger` | invoicing | MVA, forfall, gyldighet og nummerserier (administrator) |
| `/api/faktura/eksport` | invoicing | CSV for regnskap |
| `/api/cron/billing` | quotes + invoicing | planlagt utløp av tilbud og forfallsoppdatering (`CRON_SECRET`) |
| `/kundeportal/faktura` | portal + invoicing | kundens sendte fakturaer |
| `/kundeportal/faktura/[id]` | portal + invoicing | kundens fakturavisning |

Portalens fakturaside er bevisst ikke lagt i `PortalTabs` i denne grenen.

## Utskrift og PDF

Både fakturaer og tilbud har en utskriftsvennlig side som gjenbruker
`src/components/billing/PrintButton.tsx` og de eksisterende print-stilene.
`/tilbud/[id]/skriv` viser firma/merkevare fra `Branding`, kunde og kontakt,
tilbudsnummer og versjon, tilbudsdato, gyldighet, linjer med mengde/enhet,
pris, MVA og sum, totaler, notater og status.

Siden er modulgated med `quotes` og bruker `getQuote`, altså samme
avdelings-/kundeavgrensning og leserettigheter som detaljsiden. En tekniker uten
lesetilgang, en kunde som spør etter en annen kundes tilbud, og en avslått
`quotes`-modul gir alle 404. Utskriften eksponerer ikke tokenlenken eller
andre interne id-er.

**PDF er nettleserens print-til-PDF.** Det er ingen server-generert PDF, ingen
ny PDF-avhengighet og ingen e-postutsending. Brukeren velger «Skriv ut» og
deretter «Lagre som PDF» i nettleseren. Kvaliteten og sideskift styres dermed av
nettleserens skrivemotor, ikke av en egen PDF-mal. Det er en bevisst v1-
begrensning, ikke en fullverdig PDF-tjeneste.

## Datamodell

Migreringen `20261107150000_quotes_invoicing` legger til:

- `Quote`, `QuoteLine`, `QuoteVersion`
- `Invoice`, `InvoiceLine`, `Payment`, `CreditNote`
- `BillingSettings` (én rad, id `default`)
- enums `QuoteStatus`, `InvoiceStatus`, `PaymentMethod`
- nødvendige relasjoner på `Customer`, `Contact`, `Department`, `WorkOrder`,
  `Contract`, `Product` og `Report`

Beløp er `Decimal(12,2)` og MVA-sats `Decimal(5,2)`. Alle totaler regnes på
serveren i `src/lib/billing.ts`; klienten sender bare rå linjer.

## Tjenestelag

### `src/server/quotes.ts`

- `createQuote`, `updateQuote` – bare kladd kan redigeres.
- `sendQuote`, `reissueQuoteToken` – oppretter/fornyer et kortlivet
  engangstoken. Bare SHA-256-hashen lagres.
- `acceptQuoteByToken`, `rejectQuoteByToken` – offentlig flyt uten innlogging.
- `createQuoteVersion`, `cloneQuote` – revisjonshistorikk og kopi.
- `expireQuotes` – markerer utløpte sendte tilbud, idempotent.
- `convertQuoteToWorkOrder` – krever godkjent tilbud, `customers.manage` og
  `workorders.create`, re-autentiserer aktøren mot databasen og kjører i én
  transaksjon. Kunden gjenbrukes eller opprettes, og utstyret kobles til.

### `src/server/invoices.ts`

- `createInvoice` – manuelt, fra godkjent tilbud, fra fullført oppdrag eller
  rapport. Rapport/oppdrag må være `COMPLETED`.
- `sendInvoice` – tildeler unikt fakturanummer fra `BillingSettings` og fryser
  linjene.
- `registerPayment` – manuell betaling, delbetaling, idempotensnøkkel.
- `registerCreditNote` – kreditnota inkl. MVA, aldri over utestående.
- `markOverdueInvoices` – idempotent sweep.
- `exportInvoicesCsv` – lesende, stabil og idempotent eksport.
- `getPortalInvoices`, `getPortalInvoice` – alltid filtrert på innlogget
  kundes `customerId`.

Alle mutasjoner skriver revisjonsrad i samme transaksjon.

## v1-begrensninger

- **Betalingsleverandør er valgfri og miljøstyrt.** Med `PAYMENTS_PROVIDER`
  tom er flyten manuell som før. Med Stripe/Vipps opprettes en betalingslenke,
  og webhooken registrerer betalingen. Refusjon skjer fortsatt bare med
  kreditnota. Se `docs/PAYMENTS.md`.
- **Ingen refusjon.** En kreditnota kan ikke overstige utestående beløp. En
  fullt betalt faktura kan derfor ikke krediteres i v1.
- **Regnskapssynk er manuell.** Fiken, Tripletex og PowerOffice Go kan
  motta kunde, faktura og betaling. CSV markerer bare eksport. Det finnes
  ingen automatisk bakgrunnssynk eller toveis synk. Se `docs/ACCOUNTING.md`.
- **Ingen e-postutsending av tilbud/faktura.** Godkjenningslenken vises i
  grensesnittet og må deles manuelt.
- **Utskrift/PDF er print-til-PDF i nettleseren.** Det finnes ingen
  server-generert PDF for tilbud, ingen lagret PDF-fil og ingen egen PDF-mal.
  Nettsiden er optimalisert for A4-utskrift, men sideskift og fonter følger
  nettleseren.
- **Fakturanummerering kan få hull** ved samtidige sendinger fordi nummeret
  allokeres før den betingede oppdateringen. Unikhetsindeksen er skarp; hull er
  dokumentert og påvirker ikke entydigheten.
- **MVA beregnes per linje** og rundes til øre. Dokumenttotalen er summen av
  de avrundede linjene.
- **Tilbud uten kundekort** kan opprettes med `customerName`, men
  fakturering krever en kundekortkobling. Konvertering kan opprette kunden.
- **Polsk og tysk** er fullt oversatt i denne grenen. Norske og engelske
  kataloger er kilde til sannhet, og `npm run check:i18n:strict` verifiserer
  nøkkelparitet i alle fire språk.
- **Modulene er `active`** i `src/lib/modules.ts` og har navigasjons- og
  innstillingspunkter. Modulvakten gir fortsatt 404 når en modul slås av.
- **i18n-fragmentene er koblet inn** i `src/i18n/messages.ts`.
  `src/i18n/messages.test.ts` verifiserer at alle fragmentnøkler finnes i alle
  fire språk.

## Tester

- `src/lib/billing.test.ts` – MVA, øreavrunding, utestående og statusavledning.
- `src/app/billing-module-gate.test.ts` – sidene gir 404 når modulen er av.
- `src/app/tilbud/[id]/skriv/page.test.ts` – utskriftsvisningen rendrer linjer,
  totaler, merkevare og gir 404 ved manglende tilgang eller avslått modul.
- `src/server/quotes-scope.test.ts` – lesetilgang per rolle/avdeling og
  krysskundeisolasjon i tilbudsscope-en.
- `src/app/api/cron/billing/route.test.ts` – cron-vakt, modul 404 og idempotente jobber.
- `src/server/integration/quotes-invoicing.integration.test.ts` – ekte
  PostgreSQL: totaler, konfigurerbar MVA, tokenutløp, godkjenning, versjonering,
  konvertering til oppdrag, delbetaling, idempotent betaling, kreditnota,
  rettigheter, krysskundeisolasjon (inkl. tilbudslesing for utskrift), forfall
  og CSV-idempotens.
- `src/lib/payments/payments.test.ts` og
  `src/app/api/webhooks/payments/[provider]/route.test.ts` – HMAC-signaturer,
  rå kropp, rate limit, modulvakt og parsing for Stripe/Vipps.
- `src/lib/accounting/providers.test.ts` – Fiken/Tripletex/PowerOffice/CSV med
  mockede HTTP-kall, idempotensheadere og ørekonvertering.
- `src/server/accounting-sync-idempotency.test.ts` – gjentatt synk gjenbruker
  ekstern id uten nye leverandørkall.
- `src/server/integration/payments-accounting.integration.test.ts` – ekte
  PostgreSQL: webhook → betaling → fakturainnstatus, duplikat, delbetaling,
  valuta-/beløpsavvik, leverandør av, regnskapssynk og retrybar feiltilstand.

Kjør integrasjonstestene mot en dedikert database:

```bash
TEST_DATABASE_URL=postgresql://.../fsm_test npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://.../fsm_test npm run test:integration
```
