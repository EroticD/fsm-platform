# Feltnivå-RBAC

Status: **v1** (PLAT-05 delvis levert). Roller og rettigheter fantes fra før;
denne leveransen legger på feltnivå for sensitive data og håndhever det i
serveren, ikke bare i grensesnittet.

## Prinsipp

- **Serveren er autoriteten.** Hver lesetjeneste som returnerer et sensitivt
  felt må kalle redaksjonshjelperen i `src/lib/field-rbac.ts`. Skjuling i UI er
  kosmetikk og regnes ikke som kontroll.
- **Standardmatrisen bevarer dagens tilgang for ADMIN og OFFICE.** Montører,
  kundeportal og `USER` får minste privilegium.
- **Maskering er standard, ikke tomt svar.** E-post og telefon maskeres,
  beløp og signatur-URL-er settes til `null`, og feltet `redactedFields`
  forteller hvorfor. Da kan UI vise en maske uten å gjette.
- **Ingen automatisk eskalering.** En feltnøkkel kan bare utvide tilgang for
  én bruker. Den kan aldri gi ADMIN eller endre rollen.

## Policy-matrise

| Feltgruppe | ADMIN | OFFICE | TECHNICIAN | CUSTOMER | USER |
| --- | --- | --- | --- | --- | --- |
| `customerContact` – kundekontakt, e-post, telefon | Full | Full | Maskert | Egne | Maskert |
| `billingAmounts` – faktura- og betalingsbeløp | Full | Full | Maskert | Egne | Maskert |
| `reportSignatures` – rapportens signaturbilder | Full | Full | Full | Egne | Maskert |
| `payrollAmounts` – lønn, kjøretur og utlegg | Full | Full | Egne | Maskert | Maskert |

«Egne» betyr at `ownerId` eller `customerId` må matche aktøren. En montør ser
egne reiseregninger og utlegg, men ikke kollegenes. Kundeportalen ser egne
fakturabeløp og egen kontaktinfo, men ingen interne beløp eller signaturer.

### Felter per gruppe

| Gruppe | Felter som maskeres |
| --- | --- |
| `customerContact` | `email`, `phone`, `contactEmail`, `contactPhone`, `customerEmail`, `customerPhone` |
| `billingAmounts` | `subtotal`, `vatTotal`, `total`, `paidTotal`, `creditedTotal`, `outstanding`, `amount`, `unitPrice`, `lineTotal`, `lineVat`, `vatAmount`, `pendingAmount`, `approvedAmount`, `mileageAmount`, `expenseAmount`, `expenseVat` |
| `reportSignatures` | `technicianSignatureUrl`, `customerSignatureUrl`, `signatureUrl` |
| `payrollAmounts` | `amount`, `vatAmount`, `rate`, `pendingAmount`, `approvedAmount`, `mileageAmount`, `expenseAmount`, `expenseVat` |

Kontaktpersonens **navn** og kundens adresse er ikke en del av
`customerContact` i v1; de er nødvendige for å utføre oppdraget. Rapportenes
`technicianName`/`customerName` beholdes av samme grunn, mens selve
signaturbildet er skjult.

## Eksplisitt tildeling

En administrator kan gi ett felt til én bruker med nøkkelen i brukerens
`permissions`-liste, også når listen er tilpasset:

```text
fields.customerContact
fields.billingAmounts
fields.reportSignatures
fields.payrollAmounts
```

Nøkkelen utvider tilgang til hele feltgruppen for den brukeren. Den arves ikke
fra rollen og kan ikke brukes til å gi ADMIN. Ukjente verdier ignoreres.

I v1 er dette en server-/databasenøkkel: innstillingenes vanlige
rettighetsliste filtrerer bort ukjente nøkler, så feltnøkkelen må settes med
direkte database-/API-tilgang. En redigerbar feltmatrise i UI er residual.

## Hvor det håndheves

| Flate | Tjeneste/fil | Kontroll |
| --- | --- | --- |
| Kundekort | `src/server/customers.ts` | Kunde og kontakter redigeres før retur |
| REST-kunder | `src/app/api/v1/customers/**` | Samme feltkart i liste og detalj |
| Søk | `src/lib/search.ts` | Kundetreff og kontaktpersoner maskeres |
| Faktura | `src/server/invoices.ts` | Liste, detalj, portal og CSV-eksport |
| Rapporter | `src/app/api/v1/reports/[id]/route.ts` | Signatur-URL-er fjernes uten tilgang |
| Lønn/utlegg | `src/server/expenses.ts` | Godkjenning, forhåndsvisning og eksport krever `payrollAmounts` |
| UI | `formatAmount` og feltene selv | `null` vises som `••••`, aldri som 0 |

Nye lesetjenester som returnerer et av feltene over **må** legge til
redaksjon og en test. En integrasjonstest skal bevise at rollen uten tilgang
får maskert verdi, både direkte fra tjenesten og via eksport.

## Tester

- `src/lib/field-rbac.test.ts` – matrise, egne-rader, eksplisitt nøkkel,
  maskering og at JSON ikke inneholder originalverdien.
- `src/server/integration/field-rbac.integration.test.ts` – ADMIN/OFFICE vs.
  montør mot ekte PostgreSQL, kundeportalens egne fakturaer og CSV-eksport.
- `src/lib/search.test.ts` og `src/app/api/v1/customers/*.test.ts` – dekker
  søk/API-formatet; nye felt må legges til der.

## Residual (v1)

- Matrisen er **rollebasert** og kan utvides per bruker, men det finnes ingen
  egen admin-UI for å redigere feltmatrisen. Komponenten
  `src/components/settings/FieldPolicyMatrix.tsx` er skrivebeskyttet.
- Rapportsignaturer er fortsatt synlige for montører fordi de signerer og
  fullfører rapporten. Skal montører heller ikke se kundens signatur, må
  `reportSignatures` splittes i tekniske og kundesignaturer.
- Feltnivå gjelder strukturerte svar. En allerede generert PDF kan inneholde
  data fra da den ble laget; PDF-en er tjenestebevis og endres ikke.
- Aggregerte tall (BI, dashbord) er ikke feltmaskert i v1, men er allerede
  begrenset til OFFICE/ADMIN og `reports.view`.
