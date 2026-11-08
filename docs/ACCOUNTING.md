# Regnskapsintegrasjon – v1

Fakturaer kan synkroniseres manuelt til Fiken, Tripletex, PowerOffice Go eller
en generisk CSV-fil. Integrasjonen er enkel og ærlig: den oppretter kunde,
faktura og betalinger, lagrer eksterne id-er og en retrybar tilstand. Den
later aldri som et eksternt kall lyktes.

Innstillingene ligger under **Faktura → Innstillinger**, der
`src/app/faktura/innstillinger/page.tsx` rendrer `<AccountingSettings />`.
Administrator slår integrasjonen på, tester forbindelsen og ser siste synk der.

## Kjerneprinsipper

- **Én rad per faktura og leverandør.** `AccountingSync` har en unik nøkkel
  `accounting:<provider>:<invoiceId>`.
- **Idempotens.** En fullført synk gjenbrukes. Gjentatt manuell synk returnerer
  `alreadySynced` uten nye HTTP-kall. Feilede synker kan kjøres på nytt og øker
  `attemptCount`.
- **Ingen falsk suksess.** HTTP-feil gir `FAILED` med en kort feilkode. Respons-
  kroppen lagres ikke, fordi den kan inneholde kundedata.
- **CSV er eksport, ikke synk.** CSV markeres `EXPORTED`, aldri `SYNCED`.
- **Revisjon.** Hver endring, test og synk skriver revisjonsrad.

## Datamodell

Migreringen `20261109090000_payments_accounting` legger til:

| Tabell | Formål |
| --- | --- |
| `AccountingSettings` | Av/på, leverandør, siste test og siste synk. Én rad (`default`). |
| `AccountingCustomer` | Mapping fra FSM-kunde til ekstern kunde per leverandør. |
| `AccountingSync` | Tilstand per faktura/leverandør, eksterne id-er, forsøk og feil. |
| `AccountingPayment` | Tilstand per betalingsrad, med egen idempotensnøkkel. |

## Konfigurasjon

Leverandøren velges med `ACCOUNTING_PROVIDER`. Ukjent eller tom verdi gir
`csv`. Selve integrasjonen er **av** til en administrator slår den på i
`AccountingSettings`; dette hindrer at en glemt miljøvariabel begynner å skrive
til regnskapet.

| Variabel | Leverandør | Beskrivelse |
| --- | --- | --- |
| `ACCOUNTING_PROVIDER` | alle | `fiken`, `tripletex`, `poweroffice` eller `csv`. |
| `FIKEN_TOKEN` | Fiken | Personlig API-token eller OAuth-access token. |
| `FIKEN_COMPANY_SLUG` | Fiken | Selskapets slug i Fiken. |
| `FIKEN_BASE_URL` | Fiken | Standard `https://api.fiken.no/api/v2`. |
| `FIKEN_BANK_ACCOUNT` | Fiken | Bankkonto for faktura, f.eks. `1920:10001`. Påkrevd for faktura. |
| `FIKEN_PAYMENT_DEBIT_ACCOUNT` | Fiken | Debetkonto ved betaling (bank). |
| `FIKEN_PAYMENT_CREDIT_ACCOUNT` | Fiken | Kreditkonto ved betaling (kundefordring). |
| `TRIPLETEX_TOKEN` | Tripletex | API-token. |
| `TRIPLETEX_API_USER` | Tripletex | Standard `0`. |
| `TRIPLETEX_BASE_URL` | Tripletex | Standard `https://tripletex.no/v2`. |
| `TRIPLETEX_VAT_TYPE_ID` | Tripletex | MVA-type, standard `3` (25 %). |
| `TRIPLETEX_PAYMENT_TYPE_ID` | Tripletex | Påkrevd for å registrere betaling. |
| `POWEROFFICE_TOKEN` | PowerOffice | Ferdig bearer-token (alternativ til OAuth). |
| `POWEROFFICE_CLIENT_ID` / `POWEROFFICE_CLIENT_SECRET` | PowerOffice | OAuth client credentials. |
| `POWEROFFICE_TOKEN_URL` | PowerOffice | Standard `https://goapi.poweroffice.net/OAuth/Token`. |
| `POWEROFFICE_SUBSCRIPTION_KEY` | PowerOffice | Valgfri `Ocp-Apim-Subscription-Key`. |
| `POWEROFFICE_BASE_URL` | PowerOffice | Standard `https://goapi.poweroffice.net/v2`. |
| `POWEROFFICE_CUSTOMERS_PATH` | PowerOffice | Standard `/Customers`. |
| `POWEROFFICE_INVOICES_PATH` | PowerOffice | Standard `/OutgoingInvoices`. |
| `POWEROFFICE_PAYMENTS_PATH` | PowerOffice | Standard `/BankJournalVouchers`. |
| `POWEROFFICE_VAT_CODE` | PowerOffice | Standard `25`. |
| `POWEROFFICE_PAYMENT_DEBIT_ACCOUNT_ID` / `..._CREDIT_ACCOUNT_ID` | PowerOffice | Påkrevd for betaling. |

## Leverandørmatrise

| Leverandør | Kunde | Faktura | Betaling | Status |
| --- | --- | --- | --- | --- |
| Fiken | `POST /companies/{slug}/contacts` | `POST /companies/{slug}/invoices` | Journalpost via `POST /generalJournalEntries` | Implementert, ikke sandbox-verifisert |
| Tripletex | `POST /customer` | `POST /order` + `POST /invoice` | `PUT /invoice/{id}/:payment` | Implementert, ikke sandbox-verifisert |
| PowerOffice Go | `POST /Customers` | `POST /OutgoingInvoices` | Bankjournal (`/BankJournalVouchers`) | Implementert, endepunkter konfigurerbare |
| CSV | Lokal rad | Lokal rad | Lokal rad | Alltid tilgjengelig |

### Fiken

Fiken har ikke et eget betalingsendepunkt for fakturaer. Betaling bokføres
derfor som en fri journalpost: debet bank, kredit kundefordring. Kontokodene må
være satt. Faktura krever `FIKEN_BANK_ACCOUNT`. Beløp i Fiken er i øre; dette
konverteres uten flyttall.

### Tripletex

Fakturaen opprettes som ordre og deretter faktura. `TRIPLETEX_VAT_TYPE_ID` må
passe med MVA-oppsettet. Betaling krever `TRIPLETEX_PAYMENT_TYPE_ID`; uten den
feiler betalingssynken med `not_configured` i stedet for å gjette.

### PowerOffice Go

API-et bruker OAuth2 client credentials eller et ferdig bearer-token.
Ressursnavnene har variert mellom versjoner; derfor kan stiene overstyres med
miljøvariabler. Betaling bokføres som bankjournal med konfigurerbare
kontoid-er og `CustomMatchingReference = fakturanummer`.

### CSV

CSV-konnektoren lager en stabil fil lokalt. Den returnerer en deterministisk
referanse (`csv-invoice:<id>`), men gjør ingen ekstern skriving. En synk får
status `EXPORTED`, og UI viser tydelig at ingen regnskapsleverandør er
oppdatert. Bruk den eksisterende CSV-eksporten for bulk, eller denne synken
for én faktura om gangen.

## Flyt

1. Administrator slår på synk i regnskapspanelet.
2. «Test forbindelse» kaller leverandørens helsesjekk. Resultatet lagres på
   `AccountingSettings`.
3. På en sendt faktura trykker en faktoramedarbeider «Synk til regnskap».
4. Tjenesten slår opp eller oppretter kunden hos leverandøren.
5. Fakturaen opprettes, og ekstern id lagres.
6. Alle betalingsrader uten synkrad sendes. En feilet betaling gir
   `AccountingPayment.status = FAILED`, men ruller ikke tilbake fakturaen.
7. Neste forsøk gjenbruker kunde-mappingen og hopper over det som allerede er
   synkronisert.

## Rettigheter og revisjon

- Slå av/på, teste forbindelse og nullstille synk: administrator med
  `settings.manage`.
- Manuell fakturasynk: `customers.manage` eller administrator, og bare for
  fakturaer aktøren allerede kan se.
- Alle handlinger krever at `invoicing`-modulen er på.
- Revisjonsloggen inneholder leverandør, ekstern id, status og en kort
  feilkode – aldri tokens, payload eller persondata.

## Rekonsiliasjon og feilsøking

1. Sammenlign `AccountingSync.externalInvoiceId` med fakturaen i
   regnskapssystemet.
2. `FAILED` betyr at siste forsøk feilet; feilkoden står i `lastError`.
   Retry er trygt fordi kunden gjenbrukes og fakturaen har stabil nøkkel.
3. `EXPORTED` betyr CSV. Ingen ekstern tilstand er endret.
4. Hvis en synk er feilaktig fullført, kan administrator nullstille den.
   Nullstillingen sletter ikke revisjonssporet.
5. Ved leverandørbytte: mappinger og synker er per leverandør, så en ny
   leverandør får egne rader. Gamle rader beholdes.

## Sikkerhet

- Tokens leses bare fra miljøet og vises aldri i UI, logger eller database.
- HTTP-kall har tidsgrense og lagrer bare statuskoder, ikke kropper.
- Ingen automatisk synk ved fakturaopprettelse; en handling krever et bevisst
  klikk og en aktiv integrasjon.
- CSV inneholder kundenavn og fakturalinjer. Behandle filen som
  forretningsdata og importer den over en sikker kanal.

## v1-begrensninger

- **Ingen ekte sandbox-konto er brukt.** Fiken-, Tripletex- og
  PowerOffice-konnektorene er implementert mot dokumenterte endepunkter, men
  payload-felter og kontokrav må verifiseres mot leverandørens sandbox før
  produksjon.
- **v1 synkroniserer per faktura med retry.** Hver faktura synkroniseres
  manuelt, og en feilet synk kan kjøres på nytt med økende `attemptCount`. Det
  finnes ingen kontinuerlig bakgrunnssynk eller automatisk retry-jobb.
- **Ingen oppdatering av allerede sendt faktura.** Første vellykkede synk
  gjenbrukes. Endringer i regnskapet må gjøres der.
- **Ingen kreditnota- eller refusjonssynk.** Bare kunde, faktura og positive
  betalinger sendes.
- **Ingen leverandørfakturaer.** Integrasjonen dekker utgående kundefaktura,
  ikke innkommende leverandørfaktura eller bilag.
- **Ingen toveis avstemming.** Vi leser ikke fakturaer eller betalinger tilbake.
- **MVA-mapping er ikke konfigurerbar i UI.** Standard MVA-type/kode fra
  miljøet; spesielle MVA-koder, avgiftsfrie varer og utenlandsk MVA krever
  manuell kontroll.
- **Ingen e-faktura, Peppol/EHF, KID/OCR eller bankavstemming.** Fakturaen
  sendes som e-post/print, ikke som EHF, og innbetalinger avstemmes ikke mot
  banken automatisk.
- **PowerOffice-endepunkter kan variere.** Stiene er derfor konfigurerbare, og
  standardverdiene må bekreftes mot riktig API-versjon.
- **CSV er ikke en integrasjon.** Den markerer eksport, ikke bokføring.
- **Ingen sletting av eksterne data.** Nullstilling påvirker bare FSM sin
  synkrad.
